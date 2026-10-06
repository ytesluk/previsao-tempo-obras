// Lógica pura de decisão: sem I/O, sem relógio, sem rede. Tudo entra por parâmetro.
import { diaDaSemana, hhmmParaMin, minParaHhmm } from './tempo.js';

export function diaOperacional(data, regras) {
  return regras.diasOperacao.includes(diaDaSemana(data));
}

export function ehTempestade(codigo, regras) {
  return regras.chuva.codigosTempestade.includes(codigo);
}

/** Condição do tempo prevista é chuva, incluindo garoa (51–57): molha telhado e serviço externo. */
export function ehChuva(codigo, regras) {
  const c = regras.chuva;
  return (c.codigosChuva ?? []).includes(codigo) || (c.codigosGaroa ?? []).includes(codigo);
}

/**
 * Classifica uma hora da previsão pelo resultado previsto: volume (mm/h) ou condição do tempo (chuva/tempestade).
 * A probabilidade só entra se regras.chuva.probabilidadeMinimaPct for um número (padrão: null = ignorada).
 * hora = { data, hora, prob, mm, code } (prob/mm podem ser null quando o modelo não informa)
 * Chuva forte ou tempestade sempre conta como hora com risco.
 */
export function classificarHora(h, regras) {
  const c = regras.chuva;
  const prob = h.prob ?? 0;
  const mm = h.mm ?? 0;
  const tempestade = ehTempestade(h.code, regras);
  const forte = mm >= c.chuvaForteMm || tempestade;
  const porProbabilidade = Number.isFinite(c.probabilidadeMinimaPct) && prob >= c.probabilidadeMinimaPct;
  const risco = forte || porProbabilidade || mm >= c.precipitacaoMinimaMm || ehChuva(h.code, regras);
  return { ...h, prob, mm, risco, forte, tempestade };
}

/**
 * O Open-Meteo devolve a precipitação da hora ANTERIOR ("preceding hour sum"):
 * o registro das 14h cobre 13h–14h. Todo o resto da lógica usa este intervalo.
 */
export const intervaloDaHora = (hora) => ({ inicioMin: (hora - 1) * 60, fimMin: hora * 60 });

/** Mantém só as horas da data cujo intervalo se sobrepõe ao horário de obra. */
export function horasDeObra(horas, data, regras) {
  const ini = hhmmParaMin(regras.horarioObra.inicio);
  const fim = hhmmParaMin(regras.horarioObra.fim);
  return horas.filter((h) => {
    const { inicioMin, fimMin } = intervaloDaHora(h.hora);
    return h.data === data && fimMin > ini && inicioMin < fim;
  });
}

/**
 * Agrupa horas consecutivas com risco em janelas.
 * O registro das 14h cobre 13:00–14:00; os registros 14 e 15 formam a janela 13:00–15:00.
 */
export function agruparJanelas(horasClassificadas) {
  const ordenadas = [...horasClassificadas].sort((a, b) => a.hora - b.hora);
  const janelas = [];
  let atual = null;
  let ultimaHora = null;
  for (const h of ordenadas) {
    if (!h.risco) {
      atual = null;
      continue;
    }
    if (atual && h.hora === ultimaHora + 1) {
      atual.fimMin = intervaloDaHora(h.hora).fimMin;
      atual.probMax = Math.max(atual.probMax, h.prob);
      atual.mmMax = Math.max(atual.mmMax, h.mm);
      atual.forte = atual.forte || h.forte;
      atual.tempestade = atual.tempestade || h.tempestade;
    } else {
      atual = {
        ...intervaloDaHora(h.hora),
        probMax: h.prob,
        mmMax: h.mm,
        forte: h.forte,
        tempestade: h.tempestade,
        avisada: false,
      };
      janelas.push(atual);
    }
    ultimaHora = h.hora;
  }
  return janelas.map((j) => ({ ...j, inicio: minParaHhmm(j.inicioMin), fim: minParaHhmm(j.fimMin) }));
}

/** Previsão horária -> janelas de risco dentro do horário de obra. */
export function calcularJanelas(horas, data, regras) {
  const classificadas = horasDeObra(horas, data, regras).map((h) => classificarHora(h, regras));
  return agruparJanelas(classificadas);
}

// ---------------------------------------------------------------- monitoramento

/** Janelas ainda não avisadas que começam dentro da antecedência (e ainda não começaram). */
export function janelasParaAvisar(janelas, agoraMin, antecedenciaMin) {
  return janelas.filter((j) => !j.avisada && j.inicioMin > agoraMin && j.inicioMin - agoraMin <= antecedenciaMin);
}

/**
 * O alerta de chuva NÃO PREVISTA só vale para chuva que para a obra: forte ou tempestade.
 * Garoa e chuva fraca fora da previsão não viram mensagem (limiares em monitoramento.imprevisto).
 */
export function chuvaRelevante(slot, regras) {
  const cfg = regras.monitoramento.imprevisto;
  return (
    slot.mmh >= cfg.precipitacaoMinimaMmH ||
    (cfg.codigosChuva ?? []).includes(slot.code) ||
    ehTempestade(slot.code, regras)
  );
}

export function dentroDeJanela(janelas, minuto, toleranciaMin = 0) {
  return janelas.some((j) => minuto >= j.inicioMin - toleranciaMin && minuto < j.fimMin + toleranciaMin);
}

/**
 * condicoes = { atual: {data, minutos, mmh, code}, proximos: [{data, minutos, mmh, code}] }
 * Cada slot é o FIM do intervalo de 15 min que ele resume, então o ponto médio é minutos - 7,5.
 */
export function avaliarChuva(condicoes, janelas, agora, regras) {
  const cfg = regras.monitoramento.imprevisto;
  const atual = condicoes.atual ? { ...condicoes.atual, ehAtual: true } : null;
  const futuros = (condicoes.proximos ?? []).filter(
    (s) => s.data === agora.data && s.minutos > agora.minutos && s.minutos <= agora.minutos + cfg.horizonteMin,
  );
  const relevantes = [atual, ...futuros].filter((s) => s && chuvaRelevante(s, regras));
  const forasDeJanela = relevantes.filter((s) => !dentroDeJanela(janelas, s.minutos - 7.5, cfg.toleranciaJanelaMin));
  const primeiroFuturo = forasDeJanela.find((s) => !s.ehAtual);
  return {
    chovendoAgora: Boolean(atual && chuvaRelevante(atual, regras)),
    temChuva: relevantes.length > 0,
    imprevisto: forasDeJanela.length === 0 ? null : forasDeJanela.some((s) => s.ehAtual) ? 'agora' : 'proximos',
    // Início mais cedo possível da chuva: o bloco termina em `minutos`, então começa 15 min antes.
    inicioPrevistoMin: primeiroFuturo ? primeiroFuturo.minutos - 15 : null,
    mmhMax: relevantes.reduce((max, s) => Math.max(max, s.mmh), 0),
  };
}

/**
 * Decisão completa de um ciclo de monitoramento de uma obra.
 * estadoMon = { ultimoImprevistoEm (ms|null), chovendo (bool) } do estado salvo.
 * Devolve o que enviar, o novo estadoMon e os motivos de tudo que foi pulado.
 */
export function decidirMonitoramento({ condicoes, janelas, agora, agoraMs, estadoMon, relatorioEnviadoEm, regras }) {
  const cfg = regras.monitoramento;
  const anterior = estadoMon ?? { ultimoImprevistoEm: null, chovendo: false };
  const avaliacao = avaliarChuva(condicoes, janelas, agora, regras);
  const motivos = [];

  // 1. Aviso de aproximação
  let avisos = janelasParaAvisar(janelas, agora.minutos, cfg.antecedenciaAvisoMin);
  if (avisos.length && relatorioEnviadoEm != null && agoraMs - relatorioEnviadoEm < cfg.ignorarAproximacaoAposRelatorioMin * 60000) {
    motivos.push('aviso de aproximação adiado: relatório enviado há poucos minutos');
    avisos = [];
  }

  // 2. Chuva imprevista, com cooldown
  let imprevisto = null;
  if (avaliacao.imprevisto) {
    const restante =
      anterior.ultimoImprevistoEm == null ? 0 : cfg.cooldownImprevistoMin * 60000 - (agoraMs - anterior.ultimoImprevistoEm);
    if (restante > 0) {
      motivos.push(`chuva imprevista pulada: em cooldown (mais ${Math.ceil(restante / 60000)} min)`);
    } else {
      imprevisto = avaliacao.imprevisto;
    }
  }

  // 3. Chuva parou (opcional)
  const chuvaParou = Boolean(cfg.avisarChuvaParou && anterior.chovendo && !avaliacao.temChuva);

  const chovendo = avaliacao.chovendoAgora ? true : avaliacao.temChuva ? anterior.chovendo : false;
  return {
    avaliacao,
    avisos,
    imprevisto,
    chuvaParou,
    motivos,
    novoEstadoMon: {
      ultimoImprevistoEm: imprevisto ? agoraMs : anterior.ultimoImprevistoEm,
      chovendo,
    },
  };
}
