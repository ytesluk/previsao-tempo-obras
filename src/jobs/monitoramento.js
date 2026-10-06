// JOB 2: monitoramento (a cada 30 min). Compara por intervalo, nunca depende do minuto exato.
import { enviarParaDestinos } from '../envio.js';
import {
  mensagemAproximacao,
  mensagemAproximacaoConsolidada,
  mensagemChuvaParou,
  mensagemImprevisto,
  mensagemImprevistoConsolidada,
} from '../mensagens.js';
import { decidirMonitoramento, diaOperacional } from '../regras.js';
import { hhmmParaMin, partes } from '../tempo.js';
import { executarRelatorio } from './relatorio-diario.js';

/**
 * @param {object} ctx contexto
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.forcar] ignora dia de operação e horário de monitoramento (teste manual)
 */
export async function executarMonitoramento(ctx, { forcar = false } = {}) {
  const { obras, regras, logger } = ctx;
  const cfg = regras.monitoramento;
  const agora = ctx.agora();
  const t = partes(agora);
  const resultado = { avisos: 0, imprevistos: 0, parou: 0, falhas: 0 };

  if (!forcar) {
    if (!diaOperacional(t.data, regras)) {
      logger.info('Monitoramento ignorado: dia fora da operação', { data: t.data });
      return resultado;
    }
    if (t.minutos < hhmmParaMin(cfg.inicio) || t.minutos > hhmmParaMin(cfg.fim)) {
      logger.info(`Monitoramento ignorado: fora do horário (${cfg.inicio}–${cfg.fim})`, { hora: `${t.hora}:${String(t.minuto).padStart(2, '0')}` });
      return resultado;
    }
  }

  // Garante o relatório do dia (obra por obra): cobre boot atrasado e falhas anteriores.
  if (forcar || t.minutos >= hhmmParaMin(regras.relatorioDiario.horario)) {
    await executarRelatorio(ctx, { origem: 'monitoramento', ignorarDia: forcar });
  }

  // Com os alertas desligados, o ciclo serve só como rede de segurança do relatório acima.
  if (cfg.ativo === false) return resultado;

  // Coletados aqui para virarem UMA mensagem só nos grupos gerais: com dezenas de
  // unidades, um aviso por unidade viraria spam (e risco de bloqueio do número).
  const consolidado = { aproximacao: [], imprevisto: [] };

  for (const obra of obras) {
    try {
      await monitorarObra(ctx, obra, t, agora, resultado, consolidado);
    } catch (e) {
      resultado.falhas += 1;
      logger.erro(`Falha no monitoramento: ${e.message}`, { obra: obra.id });
    }
  }

  await enviarConsolidado(ctx, { t, agora, consolidado, resultado });
  return resultado;
}

async function enviarConsolidado(ctx, { t, agora, consolidado, resultado }) {
  const { geral, regras, estado, logger } = ctx;
  if (geral.destinos.length === 0) return;
  const agoraMs = agora.getTime();

  const aprox = mensagemAproximacaoConsolidada({ itens: consolidado.aproximacao, regras });
  if (aprox) {
    // vale até a primeira janela começar
    const validoAte = agoraMs + (Math.min(...consolidado.aproximacao.map((i) => i.janela.inicioMin)) - t.minutos) * 60000;
    const aceitas = await enviarParaDestinos(ctx, { destinos: geral.destinos, texto: aprox, tipo: 'aproximacao', validoAte });
    if (aceitas > 0) {
      for (const { obra, janela } of consolidado.aproximacao) estado.marcarAvisada(t.data, obra.id, janela.inicioMin);
      resultado.avisos += consolidado.aproximacao.length;
    } else {
      logger.erro('Aviso de aproximação não aceito por nenhum grupo; será tentado no próximo ciclo');
    }
  }

  const imprev = mensagemImprevistoConsolidada({ itens: consolidado.imprevisto });
  if (imprev) {
    const validoAte = agoraMs + regras.fila.validadeImprevistoMin * 60000;
    const aceitas = await enviarParaDestinos(ctx, { destinos: geral.destinos, texto: imprev, tipo: 'imprevisto', validoAte });
    if (aceitas > 0) {
      for (const { obra, estadoComCooldown } of consolidado.imprevisto) estado.setMonitor(t.data, obra.id, estadoComCooldown);
      resultado.imprevistos += consolidado.imprevisto.length;
    } else {
      logger.erro('Alerta de chuva imprevista não aceito por nenhum grupo; o cooldown não foi consumido');
    }
  }
}

async function monitorarObra(ctx, obra, t, agora, resultado, consolidado) {
  const { regras, estado, clima, logger } = ctx;
  const agoraMs = agora.getTime();
  const relatorio = estado.getRelatorio(t.data, obra.id);
  if (!relatorio) {
    logger.warn('Sem relatório do dia para a obra: chuva será avaliada sem janelas previstas', { obra: obra.id });
  }

  const condicoes = await clima.buscarCondicoesAtuais(obra);
  const anterior = estado.getMonitor(t.data, obra.id);
  const d = decidirMonitoramento({
    condicoes,
    janelas: relatorio?.janelas ?? [],
    agora: { data: t.data, minutos: t.minutos },
    agoraMs,
    estadoMon: anterior,
    relatorioEnviadoEm: relatorio?.enviadoEm ?? null,
    regras,
  });

  logger.info('Monitoramento: decisão', {
    obra: obra.id,
    chovendoAgora: d.avaliacao.chovendoAgora,
    chuvaProxima: d.avaliacao.temChuva,
    mmhMax: Number(d.avaliacao.mmhMax.toFixed(2)),
    avisosAproximacao: d.avisos.map((j) => j.inicio),
    imprevisto: d.imprevisto,
    chuvaParou: d.chuvaParou,
    pulado: d.motivos.length ? d.motivos : undefined,
  });

  const novoEstado = { ...d.novoEstadoMon };
  // Sem destinos próprios, a unidade entra na mensagem consolidada dos grupos gerais.
  const consolidar = obra.destinos.length === 0 && consolidado;

  for (const janela of d.avisos) {
    if (consolidar) {
      consolidado.aproximacao.push({ obra, janela });
      continue;
    }
    const texto = mensagemAproximacao({ obra, janela, regras });
    const validoAte = agoraMs + (janela.inicioMin - t.minutos) * 60000;
    const aceitas = await enviarParaDestinos(ctx, { destinos: obra.destinos, texto, tipo: 'aproximacao', obraId: obra.id, validoAte });
    if (aceitas > 0) {
      estado.marcarAvisada(t.data, obra.id, janela.inicioMin);
      resultado.avisos += 1;
    }
  }

  if (d.imprevisto) {
    if (consolidar) {
      // o cooldown só é gravado se o envio consolidado der certo (cópia, não referência)
      consolidado.imprevisto.push({
        obra,
        tipo: d.imprevisto,
        inicioPrevistoMin: d.avaliacao.inicioPrevistoMin,
        estadoComCooldown: { ...d.novoEstadoMon },
      });
      novoEstado.ultimoImprevistoEm = anterior?.ultimoImprevistoEm ?? null;
    } else {
      const texto = mensagemImprevisto({ obra, tipo: d.imprevisto, inicioPrevistoMin: d.avaliacao.inicioPrevistoMin });
      const validoAte = agoraMs + regras.fila.validadeImprevistoMin * 60000;
      const aceitas = await enviarParaDestinos(ctx, { destinos: obra.destinos, texto, tipo: 'imprevisto', obraId: obra.id, validoAte });
      if (aceitas > 0) resultado.imprevistos += 1;
      else novoEstado.ultimoImprevistoEm = anterior?.ultimoImprevistoEm ?? null;
    }
  }

  if (d.chuvaParou) {
    const texto = mensagemChuvaParou({ obra });
    const validoAte = agoraMs + regras.fila.validadeChuvaParouMin * 60000;
    const aceitas = await enviarParaDestinos(ctx, { destinos: obra.destinos, texto, tipo: 'chuva-parou', obraId: obra.id, validoAte });
    if (aceitas > 0 || obra.destinos.length === 0) resultado.parou += 1;
    else novoEstado.chovendo = true; // tenta avisar de novo no próximo ciclo
  }

  estado.setMonitor(t.data, obra.id, novoEstado);
}
