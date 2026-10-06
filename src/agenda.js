// Expressões cron derivadas de config/regras.json e recuperação de boot atrasado.
import { executarMonitoramento } from './jobs/monitoramento.js';
import { executarRelatorio } from './jobs/relatorio-diario.js';
import { diaOperacional } from './regras.js';
import { hhmmParaMin, partes } from './tempo.js';

/**
 * Relatório: horário exato nos dias de operação (ex.: "0 7 * * 1,2,3,4,5,6").
 * Monitoramento: a cada intervaloMin nas horas do intervalo (ex.: "*\/30 7-18 * * 1,2,3,4,5,6").
 * O job confere de novo o horário exato (18:30 dispara o cron, mas o job ignora).
 */
export function montarExpressoes(regras) {
  const dias = [...regras.diasOperacao].sort((a, b) => a - b).join(',');
  const rel = hhmmParaMin(regras.relatorioDiario.horario);
  const horaIni = Math.floor(hhmmParaMin(regras.monitoramento.inicio) / 60);
  const horaFim = Math.floor(hhmmParaMin(regras.monitoramento.fim) / 60);
  return {
    relatorio: `${rel % 60} ${Math.floor(rel / 60)} * * ${dias}`,
    monitoramento: `*/${regras.monitoramento.intervaloMin} ${horaIni}-${horaFim} * * ${dias}`,
  };
}

/**
 * Chamado ao iniciar (depois de conectar o WhatsApp).
 * - Passou do horário do relatório e ele não foi enviado: envia agora.
 * - Já foi enviado: só recarrega as janelas do estado (sem mensagem duplicada).
 * Depois faz um ciclo de monitoramento para não esperar até 30 min pelo próximo.
 * `executar(nome, fn)` permite ao chamador serializar os jobs.
 */
export async function recuperarBoot(ctx, executar = (_nome, fn) => fn()) {
  const { regras, logger } = ctx;
  const t = partes(ctx.agora());

  if (!diaOperacional(t.data, regras)) {
    logger.info('Boot: dia fora da operação, nenhum job será executado hoje', { data: t.data });
    return;
  }
  if (t.minutos < hhmmParaMin(regras.relatorioDiario.horario)) {
    logger.info(`Boot antes das ${regras.relatorioDiario.horario}: aguardando o agendamento normal`);
    return;
  }
  if (t.minutos > hhmmParaMin(regras.monitoramento.fim)) {
    logger.info(`Boot após as ${regras.monitoramento.fim}: fora do horário de operação, nada a recuperar`);
    return;
  }

  logger.info('Boot dentro do horário de operação: conferindo relatório do dia');
  await executar('relatorio-boot', () => executarRelatorio(ctx, { origem: 'boot' }));
  await executar('monitoramento-boot', () => executarMonitoramento(ctx));
}
