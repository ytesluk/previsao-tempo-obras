// npm run relatorio-agora [-- --forcar] [-- --exemplo]
// Dispara o relatório diário agora. Sem --forcar, respeita o estado (não repete o que já foi enviado hoje)
// e o dia de operação. Com --forcar, reenvia mesmo assim (útil para testar).
// Com --exemplo, usa uma previsão de chuva fictícia e um estado descartável: serve para
// demonstrar o formato da mensagem num dia sem chuva, sem afetar o relatório real do dia.
import { diaComChuva } from '../src/clima-mock.js';
import { rodarScript } from '../src/contexto.js';
import { executarRelatorio } from '../src/jobs/relatorio-diario.js';

const exemplo = process.argv.includes('--exemplo');
if (exemplo) process.env.STATE_FILE = './state/exemplo.json';

await rodarScript(async (ctx, args) => {
  if (exemplo) {
    ctx.clima.buscarPrevisaoDiaria = async (_obra, data) => diaComChuva(data, { de: 14, ate: 16, mm: 5.2 });
    ctx.logger.warn('MODO EXEMPLO: previsão fictícia, estado descartável');
  }
  const forcar = exemplo || args.includes('--forcar');
  const r = await executarRelatorio(ctx, { origem: 'manual', forcar, ignorarDia: forcar });
  ctx.logger.info('Relatório manual concluído', r);
});
