import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { condicoesPorFuncao, diaComChuva, diaSeco } from '../src/clima-mock.js';
import { criarEstado } from '../src/estado.js';
import { executarMonitoramento } from '../src/jobs/monitoramento.js';
import { executarRelatorio } from '../src/jobs/relatorio-diario.js';
import { mensagemAproximacaoConsolidada, mensagemImprevistoConsolidada } from '../src/mensagens.js';
import { partes } from '../src/tempo.js';

const regras = JSON.parse(readFileSync(new URL('../config/regras.json', import.meta.url), 'utf8'));
const SEGUNDA = '2026-09-21';
const GERAL = '120363000000000009@g.us';
// a configuração de produção está com os alertas desligados; aqui ligamos para testá-los
const comAlertas = (r) => { const c = structuredClone(r); c.monitoramento.ativo = true; return c; };
const quando = (hhmm) => new Date(`${SEGUNDA}T${hhmm}:00-03:00`);
const janela = (ini, fim, mmMax) => ({ inicioMin: ini * 60, fimMin: fim * 60, mmMax, avisada: false });

describe('textos consolidados', () => {
  test('aproximação lista cada unidade com endereço', () => {
    const m = mensagemAproximacaoConsolidada({
      regras,
      itens: [
        { obra: { nome: 'Curitiba - CIC', cidade: 'Curitiba', endereco: 'R. Accioly, 250' }, janela: janela(14, 16, 5.2) },
        { obra: { nome: 'Curitiba - Portão', cidade: 'Curitiba', endereco: 'R. Leonardo, 180' }, janela: janela(14, 16, 1) },
        { obra: { nome: 'Toledo', cidade: 'Toledo', endereco: 'R. Julio, 3465' }, janela: janela(14, 15, 1) },
      ],
    });
    const linhas = m.split('\n');
    assert.equal(linhas[0], '*CHUVA EM 1 HORA*');
    assert.equal(linhas[1], '*UNIDADES SESI/SENAI:*');
    assert.equal(linhas[3], '⏰ *Curitiba - CIC* — 14h às 16h (Chuva forte)');
    assert.equal(linhas[4], '_R. Accioly, 250_', 'Curitiba tem 2 unidades: mostra endereço');
    assert.equal(linhas.at(-1), '⏰ *Toledo* — 14h às 15h (Chuva fraca)', 'unidade única: sem endereço');
  });

  test('imprevisto distingue "agora" de horário estimado', () => {
    const m = mensagemImprevistoConsolidada({
      itens: [
        { obra: { nome: 'Palmas' }, tipo: 'agora', inicioPrevistoMin: null },
        { obra: { nome: 'Irati' }, tipo: 'proximos', inicioPrevistoMin: 625 },
      ],
    });
    assert.match(m, /\*Palmas\* — chovendo agora/);
    assert.match(m, /\*Irati\* — a partir das 10h25/);
  });

  test('lista vazia não gera mensagem', () => {
    assert.equal(mensagemAproximacaoConsolidada({ itens: [], regras }), null);
    assert.equal(mensagemImprevistoConsolidada({ itens: [] }), null);
  });
});

describe('monitoramento de muitas unidades', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'consolidado-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // 3 unidades sem destinos próprios: tudo deve sair numa mensagem só nos grupos gerais
  const unidades = [
    { id: 'cic', nome: 'Curitiba - CIC', cidade: 'Curitiba', endereco: 'R. Accioly, 250', latitude: 0, longitude: 0, destinos: [] },
    { id: 'portao', nome: 'Curitiba - Portão', cidade: 'Curitiba', endereco: 'R. Leonardo, 180', latitude: 0, longitude: 0, destinos: [] },
    { id: 'toledo', nome: 'Toledo', cidade: 'Toledo', endereco: 'R. Julio, 3465', latitude: 0, longitude: 0, destinos: [] },
  ];

  function criarCtx({ previsao, mmhEm = () => 0 }) {
    const relogio = { atual: quando('07:00') };
    const enviadas = [];
    return {
      enviadas,
      ir: (hhmm) => (relogio.atual = quando(hhmm)),
      ctx: {
        obras: unidades,
        geral: { destinos: [GERAL] },
        regras: comAlertas(regras),
        logger: { info() {}, warn() {}, erro() {} },
        estado: criarEstado(path.join(dir, 'estado.json')),
        notificador: { async enviar(destino, mensagem, o) { enviadas.push({ destino, mensagem, ...o }); return { status: 'ok' }; } },
        agora: () => relogio.atual,
        clima: {
          buscarPrevisaoDiaria: async (obra, data) => previsao(obra, data),
          buscarCondicoesAtuais: async (obra) => {
            const t = partes(relogio.atual);
            return condicoesPorFuncao(t.data, t.minutos, () => mmhEm(obra, t.minutos));
          },
        },
      },
    };
  }

  test('relatório das 07:00 sai numa mensagem só, com as unidades que têm chuva', async () => {
    const t = criarCtx({ previsao: (o, d) => (o.id === 'toledo' ? diaSeco(d) : diaComChuva(d, { de: 15, ate: 16, mm: 3 })) });
    await executarRelatorio(t.ctx);
    assert.equal(t.enviadas.length, 1, 'uma mensagem, não uma por unidade');
    assert.equal(t.enviadas[0].destino, GERAL);
    assert.match(t.enviadas[0].mensagem, /\*Curitiba - CIC\* — tarde/);
    assert.doesNotMatch(t.enviadas[0].mensagem, /R\. Accioly/, 'o relatório diário não traz endereço');
    assert.doesNotMatch(t.enviadas[0].mensagem, /Toledo/, 'sem chuva não entra');
  });

  test('aviso de 1 hora junta todas as unidades numa mensagem', async () => {
    const t = criarCtx({ previsao: (o, d) => (o.id === 'toledo' ? diaSeco(d) : diaComChuva(d, { de: 15, ate: 16, mm: 3 })) });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;

    t.ir('13:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1);
    assert.equal(t.enviadas[0].tipo, 'aproximacao');
    assert.match(t.enviadas[0].mensagem, /Curitiba - CIC/);
    assert.match(t.enviadas[0].mensagem, /Curitiba - Portão/);

    t.ir('13:15');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1, 'já avisadas, não repete');
  });

  test('chuva imprevista também vira uma mensagem só, e o cooldown é gravado', async () => {
    const t = criarCtx({ previsao: (o, d) => diaSeco(d), mmhEm: (o) => (o.id === "toledo" ? 0 : 6) });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;

    t.ir('10:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1);
    assert.equal(t.enviadas[0].tipo, 'imprevisto');
    assert.match(t.enviadas[0].mensagem, /chovendo agora/);
    assert.notEqual(t.ctx.estado.getMonitor(SEGUNDA, 'cic').ultimoImprevistoEm, null, 'cooldown gravado');

    t.ir('10:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1, 'cooldown de 2 h impede repetir');
  });

  test('envio recusado não consome o cooldown', async () => {
    const t = criarCtx({ previsao: (o, d) => diaSeco(d), mmhEm: () => 6 });
    await executarRelatorio(t.ctx);
    t.ctx.notificador.enviar = async () => {
      throw new Error('sem conexão');
    };
    t.ir('10:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.ctx.estado.getMonitor(SEGUNDA, 'cic').ultimoImprevistoEm, null);
  });
});
