// Adaptador WhatsApp (Baileys). Só ENVIA: não escuta nem processa mensagens dos grupos.
import { rmSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Fila } from './fila.js';

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sortear = (min, max) => min + Math.random() * (max - min);
const REGEX_GRUPO = /^\d+(-\d+)?@g\.us$/;

export class NotificadorBaileys {
  nome = 'baileys';

  /**
   * @param {object} o
   * @param {string} o.authDir pasta da sessão (./auth)
   * @param {object} o.logger logger do projeto
   * @param {number[]} [o.intervaloGruposMs] espera aleatória entre grupos diferentes (padrão 3–8 s)
   * @param {number} [o.aguardarConexaoMs] quanto o iniciar() espera a conexão abrir
   */
  constructor({ authDir, logger, intervaloGruposMs = [3000, 8000], aguardarConexaoMs = 120000, tentativasEnvio = 3 }) {
    this.authDir = authDir;
    this.logger = logger;
    this.intervaloGruposMs = intervaloGruposMs;
    this.aguardarConexaoMs = aguardarConexaoMs;
    this.tentativasEnvio = tentativasEnvio;
    this.fila = new Fila();
    this.pronto = false;
    this.sock = null;
    this.encerrando = false;
    this.processando = false;
    this.ultimoEnvio = null;
    this.tentativasConexao = 0;
    this.timerReconexao = null;
    this.esperandoAbrir = [];
    this.enviadas = new Map(); // cache para retentativas internas do WhatsApp (getMessage)
    this.silencioso = pino({ level: 'silent' });
  }

  get socket() {
    return this.sock;
  }

  /** Conecta e espera a conexão abrir (até `aguardarConexaoMs`). Se demorar, segue e deixa a fila segurar as mensagens. */
  async iniciar() {
    await this.#conectar();
    const abriu = await this.aguardarConexao(this.aguardarConexaoMs);
    if (!abriu) {
      this.logger.warn(
        `WhatsApp ainda não conectou após ${Math.round(this.aguardarConexaoMs / 1000)} s. O sistema segue rodando; ` +
          'as mensagens ficam em fila e saem quando a conexão abrir (se não estiverem vencidas).',
      );
    }
  }

  /** Resolve true quando conectado; false se estourar o tempo. */
  aguardarConexao(timeoutMs) {
    if (this.pronto) return Promise.resolve(true);
    return new Promise((resolve) => {
      const espera = { resolve };
      espera.timer = setTimeout(() => {
        this.esperandoAbrir = this.esperandoAbrir.filter((e) => e !== espera);
        resolve(false);
      }, timeoutMs);
      this.esperandoAbrir.push(espera);
    });
  }

  async #conectar() {
    if (this.encerrando) return;
    mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    let versao;
    try {
      ({ version: versao } = await fetchLatestBaileysVersion());
    } catch (e) {
      this.logger.warn(`Não foi possível consultar a versão mais recente do WhatsApp Web (${e.message}); usando a padrão da biblioteca`);
    }

    const sock = makeWASocket({
      ...(versao ? { version: versao } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.silencioso) },
      logger: this.silencioso,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false, // não "rouba" as notificações do celular
      getMessage: async (key) => this.enviadas.get(key.id),
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (atualizacao) => {
      if (sock === this.sock) this.#aoAtualizarConexao(atualizacao);
    });
    // Nenhum handler de 'messages.upsert': nada do que é dito nos grupos é lido ou respondido.
  }

  #aoAtualizarConexao({ connection, lastDisconnect, qr }) {
    if (qr) {
      this.logger.info('Escaneie o QR Code abaixo: WhatsApp no celular do robô > Aparelhos conectados > Conectar um aparelho');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      this.pronto = true;
      this.tentativasConexao = 0;
      this.logger.info('WhatsApp conectado', { conta: this.sock?.user?.id });
      for (const e of this.esperandoAbrir.splice(0)) {
        clearTimeout(e.timer);
        e.resolve(true);
      }
      this.#processarFila();
    }

    if (connection === 'close') {
      this.pronto = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      this.#tratarQueda(codigo, lastDisconnect?.error);
    }
  }

  #tratarQueda(codigo, erro) {
    if (this.encerrando) return;
    let espera;

    if (codigo === DisconnectReason.loggedOut) {
      this.logger.erro(
        'SESSÃO DO WHATSAPP ENCERRADA (logout): o aparelho foi desvinculado no celular ou a sessão expirou. ' +
          'Apagando a sessão salva e gerando um novo QR Code: escaneie-o para reconectar.',
      );
      this.#limparSessao();
      espera = 2000;
    } else if (codigo === DisconnectReason.connectionReplaced) {
      this.logger.erro(
        'CONEXÃO SUBSTITUÍDA: a mesma sessão foi aberta em outro lugar (outro processo do robô, listar-grupos ou outro computador). ' +
          'Nova tentativa em 5 minutos; feche a outra instância.',
      );
      espera = 5 * 60 * 1000;
    } else if (codigo === DisconnectReason.restartRequired) {
      this.logger.info('WhatsApp pediu reinício da conexão (normal logo após o pareamento)');
      espera = 0;
    } else {
      this.tentativasConexao += 1;
      espera = Math.min(2000 * 2 ** (this.tentativasConexao - 1), 60000);
      this.logger.warn(`Conexão com o WhatsApp caiu (código ${codigo ?? 'desconhecido'}${erro?.message ? `: ${erro.message}` : ''}). Reconectando em ${Math.round(espera / 1000)} s`);
    }

    clearTimeout(this.timerReconexao);
    this.timerReconexao = setTimeout(() => {
      this.#conectar().catch((e) => {
        this.logger.erro(`Falha ao reconectar: ${e.message}`);
        this.#tratarQueda(undefined, e);
      });
    }, espera);
  }

  #limparSessao() {
    try {
      for (const arquivo of readdirSync(this.authDir)) rmSync(path.join(this.authDir, arquivo), { recursive: true, force: true });
    } catch (e) {
      this.logger.erro(`Não foi possível limpar ${this.authDir}: ${e.message}. Apague a pasta manualmente e reinicie.`);
    }
  }

  /** Coloca na fila e devolve na hora; o envio acontece em segundo plano (com intervalos e reconexão). */
  async enviar(destino, mensagem, { validoAte = null, tipo = 'mensagem', obraId = null } = {}) {
    if (!REGEX_GRUPO.test(destino)) throw new Error(`Destino inválido "${destino}": use o ID de um grupo (...@g.us)`);
    this.fila.adicionar({ destino, mensagem, validoAte, tipo, obraId });
    const status = this.pronto ? 'enfileirada' : 'enfileirada-offline';
    if (!this.pronto) this.logger.warn('WhatsApp desconectado: mensagem guardada na fila', { destino, tipo, obraId });
    this.#processarFila();
    return { status };
  }

  async #processarFila() {
    if (this.processando) return;
    this.processando = true;
    try {
      while (this.pronto) {
        const { item, descartados } = this.fila.proximo(Date.now());
        for (const d of descartados) this.logger.warn('Mensagem vencida descartada da fila', { destino: d.destino, tipo: d.tipo, obraId: d.obraId });
        if (!item) break;

        await this.#respeitarIntervalo(item.destino);
        if (item.validoAte != null && Date.now() > item.validoAte) {
          this.logger.warn('Mensagem venceu durante a espera e foi descartada', { destino: item.destino, tipo: item.tipo, obraId: item.obraId });
          continue;
        }
        if (!this.pronto) {
          this.fila.devolver(item);
          break;
        }

        try {
          const resposta = await this.sock.sendMessage(item.destino, { text: item.mensagem });
          this.ultimoEnvio = { destino: item.destino, em: Date.now() };
          if (resposta?.key?.id && resposta.message) {
            this.enviadas.set(resposta.key.id, resposta.message);
            if (this.enviadas.size > 200) this.enviadas.delete(this.enviadas.keys().next().value);
          }
          this.logger.info('Mensagem enviada', { destino: item.destino, tipo: item.tipo, obraId: item.obraId });
        } catch (e) {
          item.tentativas += 1;
          if (item.tentativas >= this.tentativasEnvio) {
            this.logger.erro(`Envio falhou ${item.tentativas}x; mensagem descartada: ${e.message}`, { destino: item.destino, tipo: item.tipo, obraId: item.obraId });
          } else {
            this.logger.warn(`Envio falhou (${item.tentativas}/${this.tentativasEnvio}): ${e.message}. Tentando de novo`, { destino: item.destino });
            this.fila.devolver(item);
            await dormir(5000);
          }
        }
      }
    } finally {
      this.processando = false;
    }
  }

  /** 3–8 s aleatórios entre grupos diferentes (1–2 s se for o mesmo grupo). O primeiro envio não espera. */
  async #respeitarIntervalo(destino) {
    if (!this.ultimoEnvio) return;
    const [min, max] = this.ultimoEnvio.destino === destino ? [1000, 2000] : this.intervaloGruposMs;
    const restante = this.ultimoEnvio.em + sortear(min, max) - Date.now();
    if (restante > 0) await dormir(restante);
  }

  /** Espera a fila esvaziar (para scripts que precisam encerrar depois de enviar). */
  async aguardarEnvios(timeoutMs = 10 * 60 * 1000) {
    const limite = Date.now() + timeoutMs;
    while ((this.fila.tamanho > 0 || this.processando) && Date.now() < limite) await dormir(500);
    if (this.fila.tamanho > 0) this.logger.warn(`${this.fila.tamanho} mensagem(ns) ficaram na fila (sem conexão ou tempo esgotado)`);
  }

  /** Encerra a conexão SEM fazer logout: a sessão continua salva em ./auth. */
  async encerrar() {
    this.encerrando = true;
    clearTimeout(this.timerReconexao);
    for (const e of this.esperandoAbrir.splice(0)) {
      clearTimeout(e.timer);
      e.resolve(false);
    }
    try {
      this.sock?.end(undefined);
    } catch {
      // já estava fechado
    }
    this.pronto = false;
  }
}
