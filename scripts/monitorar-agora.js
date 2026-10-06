// npm run monitorar-agora [-- --forcar]
// Dispara um ciclo de monitoramento agora. Sem --forcar, respeita dia e horário de operação.
import { rodarScript } from '../src/contexto.js';
import { executarMonitoramento } from '../src/jobs/monitoramento.js';

await rodarScript(async (ctx, args) => {
  const r = await executarMonitoramento(ctx, { forcar: args.includes('--forcar') });
  ctx.logger.info('Monitoramento manual concluído', r);
});
