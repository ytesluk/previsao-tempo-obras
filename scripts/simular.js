// npm run simular: roda os dois jobs em DRY_RUN com dados mockados, em três cenários.
// Não acessa a internet, não usa o WhatsApp e não toca em state/ nem em logs/ (tudo em pasta temporária).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recuperarBoot } from '../src/agenda.js';
import { condicoesPorFuncao, diaComChuva, diaSeco } from '../src/clima-mock.js';
import { carregarConfig } from '../src/config.js';
import { criarEstado } from '../src/estado.js';
import { executarMonitoramento } from '../src/jobs/monitoramento.js';
import { executarRelatorio } from '../src/jobs/relatorio-diario.js';
import { criarLogger } from '../src/logger.js';
import { NotificadorConsole } from '../src/notificador/console.js';
import { partes } from '../src/tempo.js';

const DATA = '2026-09-21'; // segunda-feira
const GRUPO_1 = '120363000000000001@g.us';
const GRUPO_2 = '120363000000000002@g.us';
const GRUPO_GERAL = '120363000000000009@g.us';

// A mesma obra vai para vários grupos e o mesmo grupo recebe várias obras
const obras = [
  { id: 'norte', nome: 'Escola Norte', latitude: -25.4, longitude: -49.2, destinos: [GRUPO_1, GRUPO_2] },
  { id: 'sul', nome: 'Centro Sul', latitude: -25.5, longitude: -49.3, destinos: [GRUPO_1] },
];

const emNorte = (fn) => (obra, minutos) => (obra.id === 'norte' ? fn(minutos) : 0);

const cenarios = [
  {
    titulo: 'CENÁRIO 1: DIA SECO',
    previsao: () => diaSeco(DATA),
    mmhEm: () => 0,
    passos: [
      ['07:00', 'relatorio', 'relatório diário (com resumo consolidado)'],
      ['07:30', 'monitorar', 'monitoramento: nada a avisar'],
      ['12:00', 'boot', 'computador reiniciou: relatório já enviado, só recarrega o estado (sem duplicar)'],
    ],
  },
  {
    titulo: 'CENÁRIO 2: CHUVA PREVISTA (Escola Norte, 14h–16h)',
    previsao: (obra) => (obra.id === 'norte' ? diaComChuva(DATA, { de: 15, ate: 16, prob: 80, mm: 2 }) : diaSeco(DATA)),
    mmhEm: emNorte((min) => (min > 14 * 60 && min <= 16 * 60 ? 3 : 0)),
    passos: [
      ['07:00', 'relatorio', 'relatório: Norte com chuva, Sul estável'],
      ['12:45', 'monitorar', 'faltam 75 min: ainda não avisa'],
      ['13:00', 'monitorar', 'falta 1 hora exata: AVISO DE APROXIMAÇÃO'],
      ['13:15', 'monitorar', 'já avisada: não repete'],
      ['14:30', 'monitorar', 'chovendo dentro da janela prevista: não é imprevisto'],
    ],
  },
  {
    titulo: 'CENÁRIO 3: CHUVA IMPREVISTA (Escola Norte, 10h20–11h40, sem previsão)',
    previsao: () => diaSeco(DATA),
    mmhEm: emNorte((min) => (min > 10 * 60 + 20 && min <= 11 * 60 + 40 ? 6 : 0)),
    ajustarRegras: (regras) => {
      regras.monitoramento.avisarChuvaParou = true;
    },
    passos: [
      ['07:00', 'relatorio', 'relatório: tempo estável'],
      ['09:00', 'monitorar', 'sem chuva à vista na próxima hora'],
      ['09:30', 'monitorar', 'chuva fora de janela detectada com ~1 h de antecedência: ALERTA'],
      ['10:30', 'monitorar', 'já chovendo: cooldown de 2 h impede repetir'],
      ['11:30', 'monitorar', 'chuva persiste e o cooldown de 2 h venceu: reforça o alerta'],
      ['12:00', 'monitorar', 'sem chuva: avisa que a chuva parou (opção ligada nesta simulação)'],
    ],
  },
];

async function rodar(cenario, regrasBase) {
  const dir = mkdtempSync(path.join(tmpdir(), 'simulacao-'));
  const relogio = { atual: new Date(`${DATA}T07:00:00-03:00`) };
  const logger = criarLogger({ dir: null, relogio: () => relogio.atual });
  const contagem = {};
  const notificador = new NotificadorConsole({ logger });
  const enviarOriginal = notificador.enviar.bind(notificador);
  notificador.enviar = async (destino, mensagem, opcoes) => {
    contagem[opcoes?.tipo] = (contagem[opcoes?.tipo] ?? 0) + 1;
    return enviarOriginal(destino, mensagem, opcoes);
  };

  const regras = structuredClone(regrasBase);
  cenario.ajustarRegras?.(regras);
  const ctx = {
    obras,
    geral: { destinos: [GRUPO_GERAL] },
    regras,
    logger,
    estado: criarEstado(path.join(dir, 'estado.json'), { logger }),
    notificador,
    agora: () => relogio.atual,
    clima: {
      buscarPrevisaoDiaria: async (obra) => cenario.previsao(obra),
      buscarCondicoesAtuais: async (obra) => {
        const t = partes(relogio.atual);
        return condicoesPorFuncao(t.data, t.minutos, (min) => cenario.mmhEm(obra, min));
      },
    },
  };

  console.log(`\n${'='.repeat(78)}\n${cenario.titulo}\n${'='.repeat(78)}`);
  for (const [hhmm, tipo, descricao] of cenario.passos) {
    relogio.atual = new Date(`${DATA}T${hhmm}:00-03:00`);
    console.log(`\n--- ${hhmm} · ${descricao} ---`);
    if (tipo === 'relatorio') await executarRelatorio(ctx, { origem: 'agendado' });
    else if (tipo === 'monitorar') await executarMonitoramento(ctx);
    else if (tipo === 'boot') await recuperarBoot(ctx);
  }
  console.log(`\nMensagens simuladas neste cenário: ${JSON.stringify(contagem)}`);
  rmSync(dir, { recursive: true, force: true });
  return contagem;
}

const { regras } = carregarConfig();
const resultados = [];
for (const cenario of cenarios) resultados.push([cenario.titulo, await rodar(cenario, regras)]);

console.log(`\n${'='.repeat(78)}\nRESUMO DA SIMULAÇÃO (DRY_RUN: nenhuma mensagem foi enviada)\n${'='.repeat(78)}`);
for (const [titulo, contagem] of resultados) console.log(`${titulo}\n  ${JSON.stringify(contagem)}`);
