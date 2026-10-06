// Ponto de entrada: conecta o WhatsApp, recupera o dia (boot atrasado), agenda os jobs e mantém o processo vivo.
import cron from 'node-cron';
import { montarExpressoes, recuperarBoot } from './agenda.js';
import { criarContexto, sairComCodigo } from './contexto.js';
import { executarMonitoramento } from './jobs/monitoramento.js';
import { executarRelatorio } from './jobs/relatorio-diario.js';
import { TIMEZONE } from './tempo.js';

const ctx = await criarContexto();
const { logger, regras, config } = ctx;

process.on('unhandledRejection', (motivo) => logger.erro(`Promessa rejeitada sem tratamento: ${motivo?.stack ?? motivo}`));
process.on('uncaughtException', (e) => {
  logger.erro(`Exceção não tratada, reiniciando: ${e.stack ?? e}`);
  process.exit(1); // o PM2 sobe o processo de novo
});

logger.info('Iniciando previsao-tempo-obras', {
  obras: ctx.obras.length,
  gruposResumo: ctx.geral.destinos.length,
  notificador: ctx.notificador.nome,
  fuso: TIMEZONE,
});

// Um job por vez: relatório e monitoramento disparam juntos às 07:00 e o relatório precisa terminar antes.
let cadeia = Promise.resolve();
function executar(nome, fn) {
  cadeia = cadeia.then(async () => {
    const inicio = Date.now();
    try {
      logger.info(`Job ${nome}: início`);
      await fn();
    } catch (e) {
      logger.erro(`Job ${nome} falhou: ${e.stack ?? e.message}`);
    } finally {
      logger.info(`Job ${nome}: fim (${Date.now() - inicio} ms)`);
    }
  });
  return cadeia;
}

// 1. Conecta o WhatsApp antes de qualquer job
await ctx.notificador.iniciar();

// 2. Agenda
const expressoes = montarExpressoes(regras);
const opcoes = { timezone: TIMEZONE, noOverlap: true };
const tarefas = [
  cron.schedule(expressoes.relatorio, () => executar('relatorio-diario', () => executarRelatorio(ctx, { origem: 'agendado' })), opcoes),
  cron.schedule(expressoes.monitoramento, () => executar('monitoramento', () => executarMonitoramento(ctx)), opcoes),
];
logger.info('Jobs agendados', { relatorio: expressoes.relatorio, monitoramento: expressoes.monitoramento, fuso: TIMEZONE });

// 3. Boot atrasado: relatório perdido é enviado agora; já enviado apenas recarrega o estado
await recuperarBoot(ctx, executar);

async function encerrar(sinal) {
  logger.info(`Recebido ${sinal}: encerrando`);
  for (const t of tarefas) t.stop();
  await cadeia;
  await ctx.notificador.encerrar();
  sairComCodigo(0);
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('message', (msg) => msg === 'shutdown' && encerrar('shutdown (PM2/Windows)'));

logger.info(`Sistema no ar. Notificador: ${ctx.notificador.nome}${config.env.dryRun ? ' (DRY_RUN)' : ''}`);
