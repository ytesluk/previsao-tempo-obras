import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  agruparJanelas,
  avaliarChuva,
  calcularJanelas,
  classificarHora,
  decidirMonitoramento,
  diaOperacional,
  horasDeObra,
  janelasParaAvisar,
} from '../src/regras.js';
import { condicoes, diaComChuva, diaSeco, horasDoDia } from '../src/clima-mock.js';

const regras = JSON.parse(readFileSync(new URL('../config/regras.json', import.meta.url), 'utf8'));
const com = (alteracoes) => structuredClone({ ...regras, ...alteracoes });
const DATA = '2026-09-21'; // segunda-feira
const hora = (h, extra = {}) => ({ data: DATA, hora: h, prob: 0, mm: 0, code: 0, ...extra });

describe('classificarHora', () => {
  test('probabilidade é ignorada por padrão: só conta o resultado previsto', () => {
    assert.equal(classificarHora(hora(10, { prob: 95, mm: 0, code: 3 }), regras).risco, false);
    assert.equal(classificarHora(hora(10, { prob: 95, mm: 0, code: 2 }), regras).risco, false);
  });

  test('probabilidade volta a valer se um limiar numérico for configurado (>= inclusivo)', () => {
    const r = com({ chuva: { ...regras.chuva, probabilidadeMinimaPct: 60 } });
    assert.equal(classificarHora(hora(10, { prob: 59 }), r).risco, false);
    assert.equal(classificarHora(hora(10, { prob: 60 }), r).risco, true);
  });

  test('condição do tempo: chuva e garoa contam como risco mesmo com pouco volume; nublado não', () => {
    for (const code of [61, 63, 65, 66, 67, 80, 81, 82, 51, 53, 55, 56, 57]) {
      assert.equal(classificarHora(hora(10, { mm: 0.3, code }), regras).risco, true, `código ${code}`);
    }
    for (const code of [0, 1, 2, 3, 45]) {
      assert.equal(classificarHora(hora(10, { mm: 0.3, code }), regras).risco, false, `código ${code}`);
    }
  });

  test('precipitação >= 1 mm/h é risco mesmo com probabilidade baixa', () => {
    assert.equal(classificarHora(hora(10, { prob: 10, mm: 0.9 }), regras).risco, false);
    assert.equal(classificarHora(hora(10, { prob: 10, mm: 1 }), regras).risco, true);
  });

  test('chuva forte: >= 5 mm/h ou código de tempestade', () => {
    assert.equal(classificarHora(hora(10, { prob: 90, mm: 4.9 }), regras).forte, false);
    assert.equal(classificarHora(hora(10, { mm: 5 }), regras).forte, true);
    for (const code of [95, 96, 99]) {
      assert.equal(classificarHora(hora(10, { code }), regras).forte, true, `código ${code}`);
    }
    assert.equal(classificarHora(hora(10, { code: 65 }), regras).forte, false);
  });

  test('tempestade conta como risco mesmo com probabilidade e volume baixos', () => {
    assert.equal(classificarHora(hora(10, { prob: 5, mm: 0, code: 95 }), regras).risco, true);
  });

  test('valores nulos do modelo são tratados como zero', () => {
    const h = classificarHora(hora(10, { prob: null, mm: null }), regras);
    assert.equal(h.risco, false);
    assert.equal(h.prob, 0);
  });

  test('limiares vêm da configuração', () => {
    const r = com({ chuva: { ...regras.chuva, probabilidadeMinimaPct: 40 } });
    assert.equal(classificarHora(hora(10, { prob: 40 }), r).risco, true);
  });
});

describe('horasDeObra', () => {
  test('mantém os registros que cobrem 06:00–19:00 (o das 7h cobre 6h–7h)', () => {
    const uteis = horasDeObra(horasDoDia(DATA), DATA, regras).map((h) => h.hora);
    assert.deepEqual(uteis, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  test('ignora horas de outra data', () => {
    const horas = [hora(10), { ...hora(11), data: '2026-09-22' }];
    assert.deepEqual(horasDeObra(horas, DATA, regras).map((h) => h.hora), [10]);
  });

  test('respeita horário de obra configurado', () => {
    const r = com({ horarioObra: { inicio: '08:00', fim: '17:00' } });
    const uteis = horasDeObra(horasDoDia(DATA), DATA, r).map((h) => h.hora);
    assert.equal(uteis[0], 9, 'o registro das 9h cobre 8h–9h');
    assert.equal(uteis.at(-1), 17, 'o registro das 17h cobre 16h–17h');
  });
});

describe('agruparJanelas / calcularJanelas', () => {
  test('horas consecutivas viram uma única janela', () => {
    const horas = [14, 15, 16].map((h) => classificarHora(hora(h, { mm: 2 }), regras));
    const [j, ...resto] = agruparJanelas(horas);
    assert.equal(resto.length, 0);
    assert.equal(j.inicio, '13:00');
    assert.equal(j.fim, '16:00');
    assert.equal(j.mmMax, 2);
  });

  test('horas separadas por uma hora seca viram janelas distintas', () => {
    const horas = [9, 10, 12, 13].map((h) => classificarHora(hora(h, { mm: 2 }), regras));
    const janelas = agruparJanelas(horas);
    assert.deepEqual(janelas.map((j) => [j.inicio, j.fim]), [['08:00', '10:00'], ['11:00', '13:00']]);
  });

  test('janela guarda probabilidade máxima, volume máximo e se houve chuva forte', () => {
    const horas = [
      classificarHora(hora(14, { prob: 65, mm: 1.2 }), regras),
      classificarHora(hora(15, { prob: 80, mm: 6 }), regras),
    ];
    const [j] = agruparJanelas(horas);
    assert.equal(j.probMax, 80);
    assert.equal(j.mmMax, 6);
    assert.equal(j.forte, true);
    assert.equal(j.avisada, false);
  });

  test('não depende da ordem das horas', () => {
    const horas = [15, 14].map((h) => classificarHora(hora(h, { mm: 2 }), regras));
    assert.equal(agruparJanelas(horas).length, 1);
  });

  test('dia seco não gera janelas', () => {
    assert.deepEqual(calcularJanelas(diaSeco(DATA), DATA, regras), []);
  });

  test('chuva só fora do horário de obra é ignorada', () => {
    const horas = horasDoDia(DATA, (h) => (h < 5 || h >= 20 ? { prob: 95, mm: 3 } : {}));
    assert.deepEqual(calcularJanelas(horas, DATA, regras), []);
  });

  test('chuva nos registros 14h e 15h gera a janela 13:00–15:00', () => {
    const janelas = calcularJanelas(diaComChuva(DATA, { de: 14, ate: 15, prob: 80 }), DATA, regras);
    assert.equal(janelas.length, 1);
    assert.deepEqual([janelas[0].inicio, janelas[0].fim, janelas[0].mmMax], ['13:00', '15:00', 2]);
  });

  test('chuva que atravessa o fim do horário de obra é cortada em 19:00', () => {
    const janelas = calcularJanelas(diaComChuva(DATA, { de: 17, ate: 22 }), DATA, regras);
    assert.equal(janelas[0].inicio, '16:00');
    assert.equal(janelas[0].fim, '19:00', 'corta no fim do horário de obra');
  });
});

describe('caso real: dia de garoa (Curitiba, 21/09/2026)', () => {
  // Open-Meteo devolveu prob. de 56–71% entre 13h e 16h, mas no máximo 0,5 mm/h e código 51 (garoa) ou nublado.
  const previsao = [
    [6, 0, 0, 3], [7, 1, 0, 3], [8, 3, 0, 3], [9, 8, 0, 3], [10, 18, 0, 3], [11, 31, 0.3, 51], [12, 43, 0.5, 53],
    [13, 56, 0.3, 51], [14, 67, 0.2, 51], [15, 71, 0, 3], [16, 59, 0, 2], [17, 38, 0, 3], [18, 25, 0, 3], [19, 28, 0, 3],
  ].map(([h, prob, mm, code]) => hora(h, { prob, mm, code }));

  test('garoa gera janela, com o volume baixo preservado', () => {
    const [j, ...resto] = calcularJanelas(previsao, DATA, regras);
    assert.equal(resto.length, 0);
    assert.equal(j.inicio, '10:00');
    assert.equal(j.fim, '14:00');
    assert.equal(j.mmMax, 0.5);
    assert.equal(j.forte, false);
  });

  test('chuva de verdade à noite (21h) fica fora do horário de obra', () => {
    const noite = [...previsao, hora(21, { prob: 80, mm: 2, code: 61 }), hora(22, { prob: 80, mm: 2, code: 61 })];
    assert.equal(calcularJanelas(noite, DATA, regras).at(-1).fim, '14:00');
  });
});

describe('diaOperacional', () => {
  test('opera todos os dias da semana, inclusive sábado e domingo', () => {
    assert.equal(diaOperacional('2026-09-21', regras), true); // segunda
    assert.equal(diaOperacional('2026-09-26', regras), true); // sábado
    assert.equal(diaOperacional('2026-09-27', regras), true); // domingo
  });

  test('respeita dias configurados', () => {
    const r = com({ diasOperacao: [1, 2, 3, 4, 5] });
    assert.equal(diaOperacional('2026-09-26', r), false);
  });
});

describe('janelasParaAvisar (aproximação)', () => {
  const janela = (inicioMin, extra = {}) => ({ inicioMin, fimMin: inicioMin + 120, avisada: false, ...extra });

  test('avisa quando faltam <= 60 min, inclusive exatamente 60', () => {
    assert.equal(janelasParaAvisar([janela(14 * 60)], 13 * 60, 60).length, 1);
    assert.equal(janelasParaAvisar([janela(14 * 60)], 13 * 60 + 30, 60).length, 1);
  });

  test('não avisa com mais de 60 min de antecedência', () => {
    assert.equal(janelasParaAvisar([janela(14 * 60)], 12 * 60 + 59, 60).length, 0);
  });

  test('não avisa janela já avisada nem janela que já começou', () => {
    assert.equal(janelasParaAvisar([janela(14 * 60, { avisada: true })], 13 * 60 + 30, 60).length, 0);
    assert.equal(janelasParaAvisar([janela(14 * 60)], 14 * 60, 60).length, 0);
    assert.equal(janelasParaAvisar([janela(14 * 60)], 15 * 60, 60).length, 0);
  });

  test('atraso de alguns minutos no agendamento não perde o aviso', () => {
    assert.equal(janelasParaAvisar([janela(14 * 60)], 13 * 60 + 12, 60).length, 1);
  });
});

describe('avaliarChuva', () => {
  const agora = { data: DATA, minutos: 10 * 60 };
  const janela14 = { inicioMin: 14 * 60, fimMin: 16 * 60 };

  test('sem chuva: nada a avaliar', () => {
    const a = avaliarChuva(condicoes(DATA, '10:00', 0), [], agora, regras);
    assert.deepEqual([a.chovendoAgora, a.temChuva, a.imprevisto], [false, false, null]);
  });

  test('chovendo agora fora de janela é imprevisto "agora"', () => {
    const a = avaliarChuva(condicoes(DATA, '10:00', 6), [janela14], agora, regras);
    assert.equal(a.chovendoAgora, true);
    assert.equal(a.imprevisto, 'agora');
  });

  test('chuva nos próximos 30 min fora de janela é imprevisto "proximos"', () => {
    const c = condicoes(DATA, '10:00', 0, [{ hhmm: '10:15', mmh: 0 }, { hhmm: '10:30', mmh: 6 }]);
    const a = avaliarChuva(c, [janela14], agora, regras);
    assert.equal(a.chovendoAgora, false);
    assert.equal(a.imprevisto, 'proximos');
  });

  test('chuva dentro do horizonte de 1 h é detectada', () => {
    const c = condicoes(DATA, '10:00', 0, [{ hhmm: '11:00', mmh: 6 }]);
    const a = avaliarChuva(c, [], agora, regras);
    assert.equal(a.imprevisto, 'proximos');
    // o bloco 11:00 resume 10:45–11:00, então a chuva pode começar às 10h45
    assert.equal(a.inicioPrevistoMin, 10 * 60 + 45);
  });

  test('chuva além do horizonte de 1 h é ignorada', () => {
    const c = condicoes(DATA, '10:00', 0, [{ hhmm: '11:15', mmh: 6 }]);
    assert.equal(avaliarChuva(c, [], agora, regras).temChuva, false);
  });

  test('inicioPrevistoMin aponta o primeiro bloco com chuva, não o mais forte', () => {
    const c = condicoes(DATA, '10:00', 0, [{ hhmm: '10:30', mmh: 6 }, { hhmm: '10:45', mmh: 9 }]);
    assert.equal(avaliarChuva(c, [], agora, regras).inicioPrevistoMin, 10 * 60 + 15);
  });

  test('sem chuva futura, inicioPrevistoMin é nulo', () => {
    assert.equal(avaliarChuva(condicoes(DATA, '10:00', 6), [], agora, regras).inicioPrevistoMin, null);
  });

  test('chuva dentro de janela prevista não é imprevisto', () => {
    const c = condicoes(DATA, '14:30', 6);
    const a = avaliarChuva(c, [janela14], { data: DATA, minutos: 14 * 60 + 30 }, regras);
    assert.equal(a.chovendoAgora, true);
    assert.equal(a.imprevisto, null);
  });

  test('chuva na borda da janela é absorvida pela tolerância', () => {
    // 13:55: slot de 14:00 (13:45–14:00) tem ponto médio 13:52, 8 min antes da janela
    const c = condicoes(DATA, '13:45', 0, [{ hhmm: '14:00', mmh: 6 }]);
    const a = avaliarChuva(c, [janela14], { data: DATA, minutos: 13 * 60 + 45 }, regras);
    assert.equal(a.imprevisto, null);
    const semTolerancia = com({ monitoramento: { ...regras.monitoramento, imprevisto: { ...regras.monitoramento.imprevisto, toleranciaJanelaMin: 0 } } });
    assert.equal(avaliarChuva(c, [janela14], { data: DATA, minutos: 13 * 60 + 45 }, semTolerancia).imprevisto, 'proximos');
  });

  test('chuva fraca (garoa abaixo do limiar) não alerta', () => {
    const c = condicoes(DATA, '10:00', 0.4);
    c.atual.code = 51; // garoa
    assert.equal(avaliarChuva(c, [], agora, regras).temChuva, false);
  });

  test('tempestade alerta mesmo com volume baixo', () => {
    const c = condicoes(DATA, '10:00', 0.1);
    c.atual.code = 95;
    assert.equal(avaliarChuva(c, [], agora, regras).imprevisto, 'agora');
  });

  test('chuva não prevista só alerta se for forte ou tempestade', () => {
    const semJanela = [];
    // fraca e moderada não alertam, por mais que estejam fora da previsão
    for (const mmh of [0.5, 1.2, 3, 4.9]) {
      assert.equal(avaliarChuva(condicoes(DATA, '10:00', mmh), semJanela, agora, regras).imprevisto, null, `${mmh} mm/h`);
    }
    // a partir do limiar de chuva forte, alerta
    assert.equal(avaliarChuva(condicoes(DATA, '10:00', 5), semJanela, agora, regras).imprevisto, 'agora');

    // código de chuva forte (65) alerta mesmo com volume baixo
    const forte = condicoes(DATA, '10:00', 0.4);
    forte.atual.code = 65;
    assert.equal(avaliarChuva(forte, semJanela, agora, regras).imprevisto, 'agora');

    // código de chuva fraca (61) não alerta
    const fraca = condicoes(DATA, '10:00', 0.4);
    fraca.atual.code = 61;
    assert.equal(avaliarChuva(fraca, semJanela, agora, regras).imprevisto, null);
  });

  test('sem nenhuma janela prevista, qualquer chuva relevante é imprevisto', () => {
    assert.equal(avaliarChuva(condicoes(DATA, '10:00', 6), [], agora, regras).imprevisto, 'agora');
  });
});

describe('decidirMonitoramento', () => {
  const t = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return { agora: { data: DATA, minutos: h * 60 + m }, agoraMs: Date.UTC(2026, 8, 21, h + 3, m) };
  };
  const janelas = () => [{ inicioMin: 14 * 60, fimMin: 16 * 60, avisada: false }];
  const base = (hhmm, extra = {}) => ({
    condicoes: condicoes(DATA, hhmm, 0),
    janelas: janelas(),
    regras,
    estadoMon: null,
    relatorioEnviadoEm: null,
    ...t(hhmm),
    ...extra,
  });

  test('tudo calmo: nada a enviar', () => {
    const d = decidirMonitoramento(base('10:00'));
    assert.deepEqual([d.avisos.length, d.imprevisto, d.chuvaParou], [0, null, false]);
  });

  test('aviso de aproximação 60 min antes da janela', () => {
    const d = decidirMonitoramento(base('13:00'));
    assert.equal(d.avisos.length, 1);
    assert.equal(d.avisos[0].inicioMin, 14 * 60);
  });

  test('aviso de aproximação é adiado logo após o relatório', () => {
    const { agoraMs } = t('07:00');
    const d = decidirMonitoramento({ ...base('07:00'), janelas: [{ inicioMin: 8 * 60, fimMin: 10 * 60, avisada: false }], relatorioEnviadoEm: agoraMs - 60000 });
    assert.equal(d.avisos.length, 0);
    assert.match(d.motivos[0], /adiado/);
  });

  test('imprevisto dispara e registra o horário para o cooldown', () => {
    const b = base('10:00', { condicoes: condicoes(DATA, '10:00', 6) });
    const d = decidirMonitoramento(b);
    assert.equal(d.imprevisto, 'agora');
    assert.equal(d.novoEstadoMon.ultimoImprevistoEm, b.agoraMs);
    assert.equal(d.novoEstadoMon.chovendo, true);
  });

  test('cooldown de 2 h impede repetir o alerta', () => {
    const primeiro = base('10:00', { condicoes: condicoes(DATA, '10:00', 6) });
    const estadoMon = decidirMonitoramento(primeiro).novoEstadoMon;
    const em1h59 = decidirMonitoramento(base('11:59', { condicoes: condicoes(DATA, '11:59', 6), estadoMon }));
    assert.equal(em1h59.imprevisto, null);
    assert.match(em1h59.motivos[0], /cooldown/);
    const em2h = decidirMonitoramento(base('12:00', { condicoes: condicoes(DATA, '12:00', 6), estadoMon }));
    assert.equal(em2h.imprevisto, 'agora');
  });

  test('cooldown não guarda novo horário quando o alerta foi pulado', () => {
    const estadoMon = { ultimoImprevistoEm: t('10:00').agoraMs, chovendo: true };
    const d = decidirMonitoramento(base('10:30', { condicoes: condicoes(DATA, '10:30', 6), estadoMon }));
    assert.equal(d.novoEstadoMon.ultimoImprevistoEm, estadoMon.ultimoImprevistoEm);
  });

  test('"chuva parou" só quando habilitado, estava chovendo e não há chuva à vista', () => {
    const estadoMon = { ultimoImprevistoEm: null, chovendo: true };
    assert.equal(decidirMonitoramento(base('11:00', { estadoMon })).chuvaParou, false, 'flag desligada');

    const ligada = com({ monitoramento: { ...regras.monitoramento, avisarChuvaParou: true } });
    const parou = decidirMonitoramento(base('11:00', { estadoMon, regras: ligada }));
    assert.equal(parou.chuvaParou, true);
    assert.equal(parou.novoEstadoMon.chovendo, false);

    const aindaChove = decidirMonitoramento(base('11:00', { estadoMon, regras: ligada, condicoes: condicoes(DATA, '11:00', 0, [{ hhmm: '11:15', mmh: 6 }]) }));
    assert.equal(aindaChove.chuvaParou, false);
    assert.equal(aindaChove.novoEstadoMon.chovendo, true, 'continua marcado como chovendo');

    const semChuvaAntes = decidirMonitoramento(base('11:00', { regras: ligada }));
    assert.equal(semChuvaAntes.chuvaParou, false);
  });

  test('chuva dentro da janela prevista não gera imprevisto, mas marca chovendo', () => {
    const d = decidirMonitoramento(base('14:30', { condicoes: condicoes(DATA, '14:30', 6) }));
    assert.equal(d.imprevisto, null);
    assert.equal(d.novoEstadoMon.chovendo, true);
  });
});
