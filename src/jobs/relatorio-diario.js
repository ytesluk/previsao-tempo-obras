// JOB 1: relatório diário. Idempotente: só age sobre obras que ainda não têm relatório no estado do dia.
import { enviarParaDestinos } from '../envio.js';
import { mensagemRelatorio, mensagemResumo } from '../mensagens.js';
import { calcularJanelas, diaOperacional } from '../regras.js';
import { hhmmParaMin, instanteHoje, partes } from '../tempo.js';

const MARGEM_MINIMA_MS = 5 * 60000;

/**
 * @param {object} ctx contexto (obras, geral, regras, estado, clima, notificador, logger, agora)
 * @param {object} [opcoes]
 * @param {string} [opcoes.origem] 'agendado' | 'boot' | 'monitoramento' | 'manual' (só para o log)
 * @param {boolean} [opcoes.forcar] reenvia mesmo que o relatório do dia já tenha sido enviado
 * @param {boolean} [opcoes.ignorarDia] roda mesmo em dia fora da operação
 */
export async function executarRelatorio(ctx, { origem = 'agendado', forcar = false, ignorarDia = false } = {}) {
  const { obras, regras, estado, clima, logger } = ctx;
  const agora = ctx.agora();
  const t = partes(agora);
  const resultado = { enviados: 0, recarregados: 0, falhas: 0 };

  if (!ignorarDia && !diaOperacional(t.data, regras)) {
    logger.info('Relatório diário ignorado: dia fora da operação', { data: t.data, origem });
    return resultado;
  }

  const removidos = estado.limpar(t.data, regras.estado.retencaoDias);
  if (removidos > 0) logger.info(`Estado: ${removidos} registro(s) com mais de ${regras.estado.retencaoDias} dias removido(s)`);

  // Nunca deixa a validade no passado (ex.: relatório manual à noite)
  const validoAte = Math.max(instanteHoje(agora, regras.relatorioDiario.validoAte), agora.getTime() + MARGEM_MINIMA_MS);

  for (const obra of obras) {
    try {
      const existente = estado.getRelatorio(t.data, obra.id);
      if (existente && !forcar) {
        // No ciclo de monitoramento isso é rotina; só vale registrar em boot/manual/agendado
        if (origem !== 'monitoramento') {
          logger.info('Relatório do dia já enviado: janelas recarregadas do estado, sem mensagem duplicada', {
            obra: obra.id,
            janelas: existente.janelas.map((j) => `${j.inicio}-${j.fim}${j.avisada ? ' (avisada)' : ''}`),
            origem,
          });
        }
        resultado.recarregados += 1;
        continue;
      }

      const horas = await clima.buscarPrevisaoDiaria(obra, t.data);
      const janelas = calcularJanelas(horas, t.data, regras);
      logger.info('Relatório: decisão', {
        obra: obra.id,
        origem,
        risco: janelas.length > 0,
        janelas: janelas.map((j) => `${j.inicio}-${j.fim} (até ${j.mmMax} mm/h${j.forte ? ', forte' : ''})`),
      });

      // Sem chuva prevista não há mensagem: o estado é salvo assim mesmo, para o monitoramento
      // saber que o dia já foi avaliado e não reprocessar a cada ciclo.
      const texto = mensagemRelatorio({ obra, janelas, hora: t.hora, data: t.data, regras, agoraMin: t.minutos });
      if (texto === null) {
        logger.info('Sem chuva prevista: nenhuma mensagem enviada', { obra: obra.id, origem });
        estado.setRelatorio(t.data, obra.id, { enviadoEm: agora.getTime(), janelas });
        resultado.enviados += 1;
        continue;
      }

      const aceitas = await enviarParaDestinos(ctx, { destinos: obra.destinos, texto, tipo: 'relatorio', obraId: obra.id, validoAte });
      if (aceitas > 0 || obra.destinos.length === 0) {
        estado.setRelatorio(t.data, obra.id, { enviadoEm: agora.getTime(), janelas });
        resultado.enviados += 1;
      } else {
        resultado.falhas += 1;
        logger.erro('Relatório não foi aceito por nenhum destino; será tentado de novo no próximo ciclo', { obra: obra.id });
      }
    } catch (e) {
      resultado.falhas += 1;
      logger.erro(`Falha no relatório: ${e.message}`, { obra: obra.id });
    }
  }

  try {
    await enviarResumoConsolidado(ctx, { agora, t, validoAte, forcar });
  } catch (e) {
    logger.erro(`Falha no resumo consolidado: ${e.message}`);
  }
  return resultado;
}

async function enviarResumoConsolidado(ctx, { agora, t, validoAte, forcar }) {
  const { obras, geral, regras, estado, logger } = ctx;
  if (geral.destinos.length === 0) return;
  if (!forcar && estado.getResumo(t.data)) return;

  const itens = obras.map((obra) => {
    const r = estado.getRelatorio(t.data, obra.id);
    return r ? { obra, janelas: r.janelas } : { obra, indisponivel: true };
  });
  const faltando = itens.filter((i) => i.indisponivel).length;
  if (faltando > 0 && !forcar && t.minutos < hhmmParaMin(regras.relatorioDiario.resumoIncompletoApos)) {
    logger.warn(`Resumo consolidado adiado: ${faltando} obra(s) ainda sem previsão (nova tentativa no próximo ciclo)`);
    return;
  }

  const texto = mensagemResumo({ data: t.data, itens, regras, agoraMin: t.minutos });
  if (texto === null) {
    estado.setResumo(t.data, agora.getTime()); // nada a comunicar hoje
    return;
  }
  const aceitas = await enviarParaDestinos(ctx, { destinos: geral.destinos, texto, tipo: 'resumo', validoAte });
  if (aceitas > 0) estado.setResumo(t.data, agora.getTime());
}
