// Chamadas ao Open-Meteo (gratuito, sem chave). Devolve dados já normalizados para a lógica de regras.
import { TIMEZONE, lerIsoLocal } from './tempo.js';

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const dormirPadrao = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Com vários modelos, o Open-Meteo devolve uma coluna por modelo
 * ("precipitation_ukmo_seamless", "precipitation_best_match", ...).
 * Com um modelo só, a coluna vem sem sufixo.
 */
function colunas(bloco, campo, modelos) {
  const nomes = modelos.length > 1 ? modelos.map((m) => `${campo}_${m}`) : [campo];
  return nomes.map((n) => bloco[n]).filter(Array.isArray);
}

function exigirArrays(bloco, campos, nome, modelos) {
  if (!bloco || !Array.isArray(bloco.time) || !campos.every((c) => colunas(bloco, c, modelos).length > 0)) {
    throw new Error(`Resposta do Open-Meteo sem o bloco "${nome}" esperado`);
  }
}

/**
 * Pega o MAIOR valor entre os modelos naquele índice: se qualquer modelo prevê chuva,
 * o sistema avisa. Modelo nenhum enxerga pancada isolada sozinho.
 */
function maximo(cols, i) {
  return cols.reduce((max, c) => Math.max(max, c[i] ?? 0), 0);
}

/** O código de tempo do modelo que previu mais chuva naquela hora. */
function codigoDoMaior(colsMm, colsCode, i) {
  let melhor = 0;
  let code = 0;
  colsMm.forEach((c, k) => {
    const mm = c[i] ?? 0;
    if (mm >= melhor) {
      melhor = mm;
      code = colsCode[k]?.[i] ?? code;
    }
  });
  return code || colsCode[0]?.[i] || 0;
}

/** hourly do Open-Meteo -> [{ data, hora, prob, mm, code }] (null vira 0). */
export function normalizarPrevisaoHoraria(json, modelos = []) {
  const h = json?.hourly;
  exigirArrays(h, ['precipitation', 'weather_code'], 'hourly', modelos);
  const mm = colunas(h, 'precipitation', modelos);
  const code = colunas(h, 'weather_code', modelos);
  const prob = colunas(h, 'precipitation_probability', modelos);
  return h.time.map((iso, i) => {
    const { data, hora } = lerIsoLocal(iso);
    return { data, hora, prob: maximo(prob, i), mm: maximo(mm, i), code: codigoDoMaior(mm, code, i) };
  });
}

/**
 * current + minutely_15 -> { atual, proximos } com volumes em mm/h.
 * No Open-Meteo a precipitação de current e de minutely_15 é o total do intervalo
 * (900 s = 15 min), por isso a conversão para mm/h.
 */
export function normalizarCondicoes(json, modelos = []) {
  const c = json?.current;
  if (!c || typeof c.time !== 'string') throw new Error('Resposta do Open-Meteo sem o bloco "current" esperado');
  const intervalo = c.interval > 0 ? c.interval : 900;
  const { data, minutos } = lerIsoLocal(c.time);
  // current não vem por modelo: o Open-Meteo usa o primeiro da lista
  const atual = { data, minutos, mmh: ((c.precipitation ?? c.rain ?? 0) * 3600) / intervalo, code: c.weather_code ?? 0 };

  const m = json.minutely_15;
  exigirArrays(m, ['precipitation', 'weather_code'], 'minutely_15', modelos);
  const mm = colunas(m, 'precipitation', modelos);
  const code = colunas(m, 'weather_code', modelos);
  const proximos = m.time.map((iso, i) => {
    const t = lerIsoLocal(iso);
    return { data: t.data, minutos: t.minutos, mmh: maximo(mm, i) * 4, code: codigoDoMaior(mm, code, i) };
  });
  return { atual, proximos };
}

export function criarClima({ fetchFn = globalThis.fetch, dormir = dormirPadrao, tentativas = 3, esperaBaseMs = 1000, timeoutMs = 15000, logger = null, modelos = [] } = {}) {
  async function buscarJson(url, descricao) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      try {
        const resp = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
        if (!resp.ok) {
          const erro = new Error(`Open-Meteo respondeu HTTP ${resp.status}`);
          erro.status = resp.status;
          throw erro;
        }
        return await resp.json();
      } catch (e) {
        ultimoErro = e;
        const definitivo = e.status === 400;
        if (definitivo || tentativa === tentativas) break;
        const espera = esperaBaseMs * 3 ** (tentativa - 1);
        logger?.warn(`Open-Meteo falhou (${descricao}), tentativa ${tentativa}/${tentativas}: ${e.message}. Nova tentativa em ${espera} ms`);
        await dormir(espera);
      }
    }
    throw new Error(`Open-Meteo indisponível (${descricao}): ${ultimoErro.message}`, { cause: ultimoErro });
  }

  // o primeiro modelo da lista é o que o Open-Meteo usa no bloco 'current'
  const local = (obra) => ({ latitude: obra.latitude, longitude: obra.longitude, timezone: TIMEZONE, ...(modelos.length ? { models: modelos.join(',') } : {}) });

  return {
    /** Previsão horária de um dia "AAAA-MM-DD". */
    async buscarPrevisaoDiaria(obra, data) {
      const params = new URLSearchParams({
        ...local(obra),
        hourly: 'precipitation_probability,precipitation,weather_code',
        start_date: data,
        end_date: data,
      });
      return normalizarPrevisaoHoraria(await buscarJson(`${URL_BASE}?${params}`, `previsão diária de ${obra.nome}`), modelos);
    },

    /** Condições atuais + próximas 2 h em blocos de 15 min (cobre com folga o horizonte de 1 h). */
    async buscarCondicoesAtuais(obra) {
      const params = new URLSearchParams({
        ...local(obra),
        current: 'precipitation,rain,weather_code',
        minutely_15: 'precipitation,weather_code',
        forecast_minutely_15: '8',
      });
      return normalizarCondicoes(await buscarJson(`${URL_BASE}?${params}`, `condições atuais de ${obra.nome}`), modelos);
    },
  };
}
