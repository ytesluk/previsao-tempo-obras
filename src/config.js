// Carrega e valida config/*.json e o .env. Falha cedo, com mensagem clara.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hhmmParaMin } from './tempo.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGEX_GRUPO = /^\d+(-\d+)?@g\.us$/;

function lerJson(arquivo, { opcional = false } = {}) {
  if (!existsSync(arquivo)) {
    if (opcional) return null;
    throw new Error(`Arquivo de configuração não encontrado: ${arquivo}`);
  }
  try {
    return JSON.parse(readFileSync(arquivo, 'utf8'));
  } catch (e) {
    throw new Error(`JSON inválido em ${arquivo}: ${e.message}`);
  }
}

function exigir(condicao, mensagem) {
  if (!condicao) throw new Error(`Configuração inválida: ${mensagem}`);
}

function validarDestinos(destinos, onde) {
  exigir(Array.isArray(destinos), `${onde}: "destinos" deve ser uma lista`);
  for (const d of destinos) {
    exigir(typeof d === 'string' && REGEX_GRUPO.test(d), `${onde}: destino "${d}" não parece um ID de grupo (esperado algo como 1203630...@g.us)`);
  }
}

export function validarObras(obras) {
  exigir(Array.isArray(obras) && obras.length > 0, 'config/obras.json deve ser uma lista com ao menos uma obra');
  const ids = new Set();
  for (const o of obras) {
    exigir(o && typeof o.id === 'string' && o.id, 'toda obra precisa de "id"');
    exigir(!ids.has(o.id), `id de obra repetido: ${o.id}`);
    ids.add(o.id);
    exigir(typeof o.nome === 'string' && o.nome, `obra ${o.id}: falta "nome"`);
    exigir(Number.isFinite(o.latitude) && Math.abs(o.latitude) <= 90, `obra ${o.id}: "latitude" inválida`);
    exigir(Number.isFinite(o.longitude) && Math.abs(o.longitude) <= 180, `obra ${o.id}: "longitude" inválida`);
    validarDestinos(o.destinos, `obra ${o.id}`);
  }
  return obras;
}

export function validarRegras(r) {
  exigir(r?.chuva, 'regras.chuva ausente');
  for (const k of ['precipitacaoMinimaMm', 'chuvaModeradaMm', 'chuvaForteMm']) {
    exigir(Number.isFinite(r.chuva[k]), `regras.chuva.${k} deve ser número`);
  }
  exigir(r.chuva.probabilidadeMinimaPct == null || Number.isFinite(r.chuva.probabilidadeMinimaPct), 'regras.chuva.probabilidadeMinimaPct deve ser número ou null (ignorar probabilidade)');
  exigir(Array.isArray(r.chuva.codigosTempestade), 'regras.chuva.codigosTempestade deve ser lista');
  exigir(Array.isArray(r.chuva.codigosChuva), 'regras.chuva.codigosChuva deve ser lista');
  exigir(hhmmParaMin(r.horarioObra?.inicio) < hhmmParaMin(r.horarioObra?.fim), 'horarioObra.inicio deve ser antes de fim');
  exigir(Array.isArray(r.diasOperacao) && r.diasOperacao.length > 0 && r.diasOperacao.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'diasOperacao deve ser lista de 0 (domingo) a 6 (sábado)');
  hhmmParaMin(r.relatorioDiario?.horario);
  hhmmParaMin(r.relatorioDiario?.validoAte);
  hhmmParaMin(r.relatorioDiario?.resumoIncompletoApos);
  const m = r.monitoramento;
  exigir(m && hhmmParaMin(m.inicio) < hhmmParaMin(m.fim), 'monitoramento.inicio deve ser antes de fim');
  exigir(Number.isInteger(m.intervaloMin) && m.intervaloMin > 0 && 60 % m.intervaloMin === 0, 'monitoramento.intervaloMin deve dividir 60 (ex.: 15, 30, 60)');
  for (const k of ['antecedenciaAvisoMin', 'ignorarAproximacaoAposRelatorioMin', 'cooldownImprevistoMin']) {
    exigir(Number.isFinite(m[k]) && m[k] >= 0, `monitoramento.${k} deve ser número >= 0`);
  }
  exigir(typeof m.avisarChuvaParou === 'boolean', 'monitoramento.avisarChuvaParou deve ser true/false');
  for (const k of ['horizonteMin', 'precipitacaoMinimaMmH', 'toleranciaJanelaMin']) {
    exigir(Number.isFinite(m.imprevisto?.[k]) && m.imprevisto[k] >= 0, `monitoramento.imprevisto.${k} deve ser número >= 0`);
  }
  exigir(Number.isFinite(r.fila?.validadeImprevistoMin), 'fila.validadeImprevistoMin ausente');
  exigir(Number.isFinite(r.fila?.validadeChuvaParouMin), 'fila.validadeChuvaParouMin ausente');
  exigir(Array.isArray(r.modelos) && r.modelos.every((m) => typeof m === 'string'), 'modelos deve ser lista de nomes de modelo do Open-Meteo');
  exigir(Number.isInteger(r.estado?.retencaoDias) && r.estado.retencaoDias > 0, 'estado.retencaoDias deve ser inteiro > 0');
  return r;
}

function boolEnv(valor, padrao) {
  if (valor == null || valor === '') return padrao;
  return ['true', '1', 'sim', 'yes'].includes(String(valor).trim().toLowerCase());
}

/** Lê o .env (se existir) para process.env, sem sobrescrever variáveis já definidas. */
export function carregarEnv(raiz = RAIZ) {
  const arquivo = path.join(raiz, '.env');
  if (existsSync(arquivo)) process.loadEnvFile(arquivo);
}

export function carregarConfig({ raiz = RAIZ } = {}) {
  carregarEnv(raiz);
  const obras = validarObras(lerJson(path.join(raiz, 'config', 'obras.json')));
  const regras = validarRegras(lerJson(path.join(raiz, 'config', 'regras.json')));
  const geral = lerJson(path.join(raiz, 'config', 'geral.json'), { opcional: true }) ?? { destinos: [] };
  validarDestinos(geral.destinos ?? [], 'config/geral.json');
  geral.destinos ??= [];

  const resolver = (valor, padrao) => path.resolve(raiz, valor || padrao);
  return {
    obras,
    regras,
    geral,
    env: {
      notificador: (process.env.NOTIFICADOR || 'console').trim().toLowerCase(),
      dryRun: boolEnv(process.env.DRY_RUN, true),
      conexaoTimeoutS: Number(process.env.CONEXAO_TIMEOUT_S) || 120,
    },
    caminhos: {
      raiz,
      auth: resolver(process.env.AUTH_DIR, 'auth'),
      estado: resolver(process.env.STATE_FILE, path.join('state', 'estado.json')),
      logs: resolver(process.env.LOG_DIR, 'logs'),
      tmp: resolver(null, path.join('state', 'tmp')),
    },
  };
}
