import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { criarClima, normalizarCondicoes, normalizarPrevisaoHoraria } from '../src/clima.js';

// Formato real devolvido pelo Open-Meteo (recortado)
const respostaHoraria = {
  hourly: {
    time: ['2026-09-21T13:00', '2026-09-21T14:00', '2026-09-21T15:00'],
    precipitation_probability: [56, 67, null],
    precipitation: [0.0, 1.5, 0.2],
    weather_code: [3, 61, 95],
  },
};

const respostaAtual = {
  current: { time: '2026-09-21T11:15', interval: 900, precipitation: 0.5, rain: 0.5, weather_code: 61 },
  minutely_15: {
    time: ['2026-09-21T11:15', '2026-09-21T11:30'],
    precipitation: [0.5, null],
    weather_code: [61, 3],
  },
};

const ok = (corpo) => async () => ({ ok: true, status: 200, json: async () => corpo });
const falha = (status) => async () => ({ ok: false, status, json: async () => ({}) });
const semEspera = async () => {};

describe('normalização', () => {
  test('previsão horária: separa data/hora e trata null como 0', () => {
    const horas = normalizarPrevisaoHoraria(respostaHoraria);
    assert.deepEqual(horas[1], { data: '2026-09-21', hora: 14, prob: 67, mm: 1.5, code: 61 });
    assert.equal(horas[2].prob, 0);
  });

  test('condições: converte mm por 15 min em mm/h', () => {
    const c = normalizarCondicoes(respostaAtual);
    assert.equal(c.atual.mmh, 2); // 0,5 mm em 900 s
    assert.equal(c.atual.minutos, 11 * 60 + 15);
    assert.equal(c.proximos[0].mmh, 2);
    assert.equal(c.proximos[1].mmh, 0);
  });

  test('resposta sem os blocos esperados gera erro claro', () => {
    assert.throws(() => normalizarPrevisaoHoraria({}), /hourly/);
    assert.throws(() => normalizarCondicoes({}), /current/);
  });
});

describe('criarClima', () => {
  const obra = { nome: 'Obra X', latitude: -25.43, longitude: -49.27 };

  test('monta a URL com timezone America/Sao_Paulo e os campos pedidos', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return ok(urls.length === 1 ? respostaHoraria : respostaAtual)();
    };
    const clima = criarClima({ fetchFn });
    await clima.buscarPrevisaoDiaria(obra, '2026-09-21');
    await clima.buscarCondicoesAtuais(obra);

    const diaria = new URL(urls[0]);
    assert.equal(diaria.origin + diaria.pathname, 'https://api.open-meteo.com/v1/forecast');
    assert.equal(diaria.searchParams.get('timezone'), 'America/Sao_Paulo');
    assert.equal(diaria.searchParams.get('hourly'), 'precipitation_probability,precipitation,weather_code');
    assert.equal(diaria.searchParams.get('start_date'), '2026-09-21');

    const atual = new URL(urls[1]);
    assert.equal(atual.searchParams.get('timezone'), 'America/Sao_Paulo');
    assert.equal(atual.searchParams.get('current'), 'precipitation,rain,weather_code');
    assert.equal(atual.searchParams.get('minutely_15'), 'precipitation,weather_code');
  });

  test('tenta de novo com backoff e acaba tendo sucesso', async () => {
    let chamadas = 0;
    const esperas = [];
    const fetchFn = async () => (++chamadas < 3 ? falha(503)() : ok(respostaHoraria)());
    const clima = criarClima({ fetchFn, dormir: async (ms) => esperas.push(ms), esperaBaseMs: 1000 });
    const horas = await clima.buscarPrevisaoDiaria(obra, '2026-09-21');
    assert.equal(chamadas, 3);
    assert.deepEqual(esperas, [1000, 3000]);
    assert.equal(horas.length, 3);
  });

  test('desiste após 3 tentativas e explica o motivo', async () => {
    let chamadas = 0;
    const clima = criarClima({ fetchFn: async () => (chamadas++, falha(500)()), dormir: semEspera });
    await assert.rejects(clima.buscarPrevisaoDiaria(obra, '2026-09-21'), /indisponível.*Obra X.*HTTP 500/);
    assert.equal(chamadas, 3);
  });

  test('erro de rede também é repetido', async () => {
    let chamadas = 0;
    const fetchFn = async () => {
      if (++chamadas === 1) throw new TypeError('fetch failed');
      return ok(respostaAtual)();
    };
    const clima = criarClima({ fetchFn, dormir: semEspera });
    await clima.buscarCondicoesAtuais(obra);
    assert.equal(chamadas, 2);
  });

  test('HTTP 400 (parâmetro inválido) não é repetido', async () => {
    let chamadas = 0;
    const clima = criarClima({ fetchFn: async () => (chamadas++, falha(400)()), dormir: semEspera });
    await assert.rejects(clima.buscarPrevisaoDiaria(obra, '2026-09-21'));
    assert.equal(chamadas, 1);
  });
});
