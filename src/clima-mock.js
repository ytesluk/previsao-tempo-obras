// Construtores de dados simulados no formato interno do clima.js. Usados nos testes e em `npm run simular`.

/** 24 horas de um dia, com valores dados por uma função opcional (hora) => { prob, mm, code }. */
export function horasDoDia(data, funcao = () => ({})) {
  return Array.from({ length: 24 }, (_, hora) => ({
    data,
    hora,
    prob: 0,
    mm: 0,
    code: 0,
    ...funcao(hora),
  }));
}

export function diaSeco(data) {
  return horasDoDia(data, (h) => ({ prob: h % 5, code: 1 }));
}

/** Chuva nas horas [de, ate] inclusive, com probabilidade e volume dados. */
export function diaComChuva(data, { de, ate, prob = 80, mm = 2, code = 61 }) {
  return horasDoDia(data, (h) => (h >= de && h <= ate ? { prob, mm, code } : { prob: 10, code: 3 }));
}

/** Condições no formato normalizado (mm/h). `proximos` = [{ hhmm: '10:15', mmh }]. */
export function condicoes(data, hhmm, mmh = 0, proximos = []) {
  const slot = (h, valor, code) => {
    const [hh, mm] = h.split(':').map(Number);
    return { data, minutos: hh * 60 + mm, mmh: valor, code: code ?? (valor > 0 ? 61 : 0) };
  };
  return {
    atual: slot(hhmm, mmh),
    proximos: proximos.map((p) => slot(p.hhmm, p.mmh, p.code)),
  };
}

/**
 * Condições a partir de uma função mmhEm(minutosDoDia). Reproduz o formato do Open-Meteo:
 * slot atual = início do intervalo de 15 min corrente; próximos = 4 slots seguintes.
 */
export function condicoesPorFuncao(data, minutosAgora, mmhEm) {
  const base = Math.floor(minutosAgora / 15) * 15;
  const slot = (minutos) => {
    const mmh = mmhEm(minutos);
    return { data, minutos, mmh, code: mmh > 0 ? 61 : 0 };
  };
  return { atual: slot(base), proximos: [0, 15, 30, 45, 60].map((d) => slot(base + d)) };
}
