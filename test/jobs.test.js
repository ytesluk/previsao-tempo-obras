import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import cron from 'node-cron';
import { montarExpressoes, recuperarBoot } from '../src/agenda.js';
import { condicoesPorFuncao, diaComChuva, diaSeco } from '../src/clima-mock.js';
import { criarEstado } from '../src/estado.js';
import { executarMonitoramento } from '../src/jobs/monitoramento.js';
import { executarRelatorio } from '../src/jobs/relatorio-diario.js';
import { partes } from '../src/tempo.js';

const regrasBase = JSON.parse(readFileSync(new URL('../config/regras.json', import.meta.url), 'utf8'));
const SEGUNDA = '2026-09-21';
const DOMINGO = '2026-09-27';
const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const GERAL = '120363000000000009@g.us';

// a configuração de produção está com os alertas desligados; aqui ligamos para testá-los
const comAlertas = (r) => { const c = structuredClone(r); c.monitoramento.ativo = true; return c; };
const quando = (data, hhmm) => new Date(`${data}T${hhmm}:00-03:00`);
const logSilencioso = { info() {}, warn() {}, erro() {} };

/** Contexto de teste: relógio controlável, clima roteirizado, notificador que grava tudo. */
function criarCtx({ dir, obras, geral = [], previsao, mmhEm = () => 0, regras = regrasBase, falharEnvioPara = [] }) {
  const relogio = { atual: quando(SEGUNDA, '07:00') };
  const enviadas = [];
  const erros = [];
  const chamadasClima = { previsao: 0, atuais: 0 };
  const ctx = {
    obras,
    geral: { destinos: geral },
    regras: comAlertas(regras),
    logger: { ...logSilencioso, erro: (m) => erros.push(m) },
    estado: criarEstado(path.join(dir, 'estado.json')),
    notificador: {
      nome: 'teste',
      async enviar(destino, mensagem, opcoes) {
        if (falharEnvioPara.includes(destino)) throw new Error('destino inválido');
        enviadas.push({ destino, mensagem, ...opcoes });
        return { status: 'simulada' };
      },
    },
    agora: () => relogio.atual,
    clima: {
      async buscarPrevisaoDiaria(obra, data) {
        chamadasClima.previsao += 1;
        const r = previsao(obra, data);
        if (r instanceof Error) throw r;
        return r;
      },
      async buscarCondicoesAtuais(obra) {
        chamadasClima.atuais += 1;
        const t = partes(relogio.atual);
        const r = mmhEm(obra, t.minutos);
        if (r instanceof Error) throw r;
        return condicoesPorFuncao(t.data, t.minutos, () => r);
      },
    },
  };
  return { ctx, relogio, enviadas, erros, chamadasClima, ir: (data, hhmm) => (relogio.atual = quando(data, hhmm)) };
}

const obraA = { id: 'a', nome: 'Obra A', latitude: 0, longitude: 0, destinos: [G1, G2] };
const obraB = { id: 'b', nome: 'Obra B', latitude: 0, longitude: 0, destinos: [G1] };
const chuvaA = (obra, data) => (obra.id === 'a' ? diaComChuva(data, { de: 15, ate: 16, prob: 80 }) : diaSeco(data));

let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'jobs-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('relatório diário', () => {
  test('envia a cada destino da obra, salva as janelas e o mesmo grupo recebe várias obras', async () => {
    const t = criarCtx({ dir, obras: [obraA, obraB], previsao: chuvaA });
    const r = await executarRelatorio(t.ctx);
    assert.equal(r.enviados, 2);
    assert.deepEqual(t.enviadas.map((e) => [e.obraId, e.destino]), [['a', G1], ['a', G2]], 'obra B está sem chuva: não manda nada');
    assert.match(t.enviadas[0].mensagem, /PREVISÃO DE CHUVA — OBRA A/);
    assert.match(t.enviadas[0].mensagem, /14h às 16h/);
    assert.equal(t.ctx.estado.getRelatorio(SEGUNDA, 'a').janelas[0].inicio, '14:00');
    assert.deepEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'b').janelas, []);
  });

  test('executar de novo não duplica mensagens (boot depois do envio)', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    const antes = t.enviadas.length;
    const r = await executarRelatorio(t.ctx, { origem: 'boot' });
    assert.equal(t.enviadas.length, antes);
    assert.equal(r.recarregados, 1);
    assert.equal(t.chamadasClima.previsao, 1, 'nem consulta a API de novo');
  });

  test('--forcar reenvia mesmo com relatório já enviado', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaComChuva(d, { de: 15, ate: 16, mm: 2 }) });
    await executarRelatorio(t.ctx);
    await executarRelatorio(t.ctx, { forcar: true });
    assert.equal(t.enviadas.length, 2);
  });

  test('falha em uma obra não interrompe as demais e a obra com falha é refeita depois', async () => {
    let apiCaida = true;
    const t = criarCtx({ dir, obras: [obraA, obraB], previsao: (o, d) => (o.id === 'a' && apiCaida ? new Error('API fora') : diaComChuva(d, { de: 15, ate: 16, mm: 2 })) });
    const r = await executarRelatorio(t.ctx);
    assert.deepEqual([r.enviados, r.falhas], [1, 1]);
    assert.equal(t.ctx.estado.getRelatorio(SEGUNDA, 'a'), null);
    assert.ok(t.erros.some((m) => /API fora/.test(m)));

    apiCaida = false;
    await executarRelatorio(t.ctx, { origem: 'monitoramento' });
    assert.notEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'a'), null);
    assert.equal(t.enviadas.filter((e) => e.obraId === 'b').length, 1, 'obra B não é reenviada');
  });

  test('destino inválido não impede os outros destinos da mesma obra', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA, falharEnvioPara: [G1] });
    await executarRelatorio(t.ctx);
    assert.deepEqual(t.enviadas.map((e) => e.destino), [G2]);
    assert.notEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'a'), null);
  });

  test('se nenhum destino aceitar, o relatório não é marcado como enviado (tenta de novo)', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaComChuva(d, { de: 15, ate: 16, mm: 2 }), falharEnvioPara: [G1] });
    const r = await executarRelatorio(t.ctx);
    assert.equal(r.falhas, 1);
    assert.equal(t.ctx.estado.getRelatorio(SEGUNDA, 'b'), null);
  });

  test('dia fora dos dias configurados não roda', async () => {
    const soSegunda = structuredClone(regrasBase);
    soSegunda.diasOperacao = [1];
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA, regras: soSegunda });
    t.ir(DOMINGO, '07:00');
    await executarRelatorio(t.ctx);
    assert.equal(t.enviadas.length, 0);
    assert.equal(t.chamadasClima.previsao, 0);
  });

  test('resumo consolidado é enviado uma única vez, com todas as obras', async () => {
    const t = criarCtx({ dir, obras: [obraA, obraB], geral: [GERAL], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    await executarRelatorio(t.ctx, { origem: 'boot' });
    const resumos = t.enviadas.filter((e) => e.tipo === 'resumo');
    assert.equal(resumos.length, 1);
    assert.equal(resumos[0].destino, GERAL);
    assert.match(resumos[0].mensagem, /\*Obra A\* — tarde/);
    assert.doesNotMatch(resumos[0].mensagem, /Obra B/, 'obra sem chuva não entra no resumo');
  });

  test('sem grupos em geral.json não há resumo', async () => {
    const t = criarCtx({ dir, obras: [obraB], geral: [], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    assert.equal(t.enviadas.filter((e) => e.tipo === 'resumo').length, 0);
  });

  test('resumo espera todas as obras até 08:00 e depois sai com "previsão indisponível"', async () => {
    const t = criarCtx({ dir, obras: [obraA, obraB], geral: [GERAL], previsao: (o, d) => (o.id === 'a' ? new Error('fora') : diaSeco(d)) });
    await executarRelatorio(t.ctx); // 07:00
    assert.equal(t.enviadas.filter((e) => e.tipo === 'resumo').length, 0);
    t.ir(SEGUNDA, '08:00');
    await executarRelatorio(t.ctx, { origem: 'monitoramento' });
    const [resumo] = t.enviadas.filter((e) => e.tipo === 'resumo');
    assert.match(resumo.mensagem, /Sem previsão disponível.*Obra A/);
  });

  test('boot atrasado: janela já encerrada não gera mensagem, mas o estado a preserva', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaComChuva(d, { de: 7, ate: 7, mm: 2 }) });
    t.ir(SEGUNDA, '08:00');
    await executarRelatorio(t.ctx, { origem: 'boot' });
    assert.equal(t.enviadas.length, 0, 'a chuva das 6h já passou: não avisa');
    // a janela continua salva: o monitoramento precisa dela para não tratar a chuva como imprevista
    assert.deepEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'b').janelas.map((j) => j.inicio), ['06:00']);
  });

  test('validade do relatório vai até 18:00 e a saudação acompanha a hora do boot', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaComChuva(d, { de: 15, ate: 16, mm: 2 }) });
    t.ir(SEGUNDA, '13:00');
    await executarRelatorio(t.ctx, { origem: 'boot' });
    assert.match(t.enviadas[0].mensagem, /_Boa tarde!/);
    assert.equal(t.enviadas[0].validoAte, quando(SEGUNDA, '18:00').getTime());
  });

  test('registros com mais de 7 dias são removidos do estado', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: chuvaA });
    t.ctx.estado.setRelatorio('2026-09-01', 'b', { enviadoEm: 1, janelas: [] });
    await executarRelatorio(t.ctx);
    assert.equal(t.ctx.estado.getRelatorio('2026-09-01', 'b'), null);
    assert.notEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'b'), null);
  });
});

describe('monitoramento', () => {
  test('aviso de aproximação sai uma única vez, 60 min antes, e vale até o início da janela', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;

    t.ir(SEGUNDA, '12:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 0);

    t.ir(SEGUNDA, '13:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 2); // 2 grupos
    assert.match(t.enviadas[0].mensagem, /CHUVA EM 1 HORA — OBRA A/);
    assert.match(t.enviadas[0].mensagem, /Começa às \*14h\*/);
    assert.equal(t.enviadas[0].validoAte, quando(SEGUNDA, '14:00').getTime());

    t.ir(SEGUNDA, '13:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 2, 'já avisada, não repete');
    assert.equal(t.ctx.estado.getRelatorio(SEGUNDA, 'a').janelas[0].avisada, true);
  });

  test('atraso de alguns minutos no ciclo ainda avisa (comparação por intervalo)', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;
    t.ir(SEGUNDA, '13:22'); // ciclo das 13:00 perdido por boot atrasado
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 2);
  });

  test('aviso logo após o relatório é adiado para o próximo ciclo (evita duas mensagens seguidas)', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: (o, d) => diaComChuva(d, { de: 9, ate: 10, prob: 90 }) });
    await executarRelatorio(t.ctx); // 07:00: janela 08:00 está a 60 min
    t.enviadas.length = 0;
    await executarMonitoramento(t.ctx); // ainda 07:00
    assert.equal(t.enviadas.length, 0);
    t.ir(SEGUNDA, '07:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 2);
  });

  test('chuva imprevista alerta uma vez e respeita o cooldown de 2 h', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d), mmhEm: () => 6 });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;

    t.ir(SEGUNDA, '10:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1);
    assert.match(t.enviadas[0].mensagem, /CHUVA NÃO PREVISTA — OBRA B/);
    assert.match(t.enviadas[0].mensagem, /Chovendo \*agora\*/);
    assert.equal(t.enviadas[0].validoAte, quando(SEGUNDA, '10:45').getTime());

    t.ir(SEGUNDA, '11:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 1, 'em cooldown');

    t.ir(SEGUNDA, '12:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.length, 2, 'cooldown terminou');
  });

  test('chuva dentro da janela prevista não gera alerta de imprevisto', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA, mmhEm: () => 6 });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;
    t.ir(SEGUNDA, '14:30');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.filter((e) => e.tipo === 'imprevisto').length, 0);
  });

  test('"chuva parou" só é enviado com a opção ligada', async () => {
    const regras = structuredClone(regrasBase);
    regras.monitoramento.avisarChuvaParou = true;
    let chovendo = true;
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d), mmhEm: () => (chovendo ? 6 : 0), regras });
    await executarRelatorio(t.ctx);
    t.ir(SEGUNDA, '10:00');
    await executarMonitoramento(t.ctx);
    chovendo = false;
    t.ir(SEGUNDA, '10:30');
    await executarMonitoramento(t.ctx);
    assert.deepEqual(t.enviadas.filter((e) => e.tipo !== 'relatorio').map((e) => e.tipo), ['imprevisto', 'chuva-parou']);
    t.ir(SEGUNDA, '11:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.filter((e) => e.tipo === 'chuva-parou').length, 1, 'não repete');
  });

  test('só roda de 07:00 a 18:00 (inclusive) em dia de operação', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d) });
    for (const [data, hhmm, roda] of [[SEGUNDA, '06:30', false], [SEGUNDA, '07:00', true], [SEGUNDA, '18:00', true], [SEGUNDA, '18:30', false], [DOMINGO, '10:00', true]]) {
      t.chamadasClima.atuais = 0;
      t.ir(data, hhmm);
      await executarMonitoramento(t.ctx);
      assert.equal(t.chamadasClima.atuais > 0, roda, `${data} ${hhmm}`);
    }
  });

  test('forcar ignora horário e dia de operação', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d) });
    t.ir(DOMINGO, '22:00');
    await executarMonitoramento(t.ctx, { forcar: true });
    assert.equal(t.chamadasClima.atuais, 1);
  });

  test('sem relatório do dia (boot atrasado), o monitoramento envia o relatório antes de avaliar', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    t.ir(SEGUNDA, '09:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.enviadas.filter((e) => e.tipo === 'relatorio').length, 2);
    assert.notEqual(t.ctx.estado.getRelatorio(SEGUNDA, 'a'), null);
  });

  test('falha do clima em uma obra não interrompe as outras', async () => {
    const t = criarCtx({
      dir,
      obras: [obraA, obraB],
      previsao: (o, d) => diaSeco(d),
      mmhEm: (obra) => (obra.id === 'a' ? new Error('timeout') : 6),
    });
    await executarRelatorio(t.ctx);
    t.enviadas.length = 0;
    t.ir(SEGUNDA, '10:00');
    const r = await executarMonitoramento(t.ctx);
    assert.equal(r.falhas, 1);
    assert.deepEqual(t.enviadas.map((e) => e.obraId), ['b']);
  });

  test('envio que falhou não consome o cooldown nem marca a janela como avisada', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d), mmhEm: () => 6 });
    await executarRelatorio(t.ctx);
    t.ctx.notificador.enviar = async () => {
      throw new Error('sem conexão');
    };
    t.ir(SEGUNDA, '10:00');
    await executarMonitoramento(t.ctx);
    assert.equal(t.ctx.estado.getMonitor(SEGUNDA, 'b').ultimoImprevistoEm, null);
  });
});

describe('agenda e boot', () => {
  test('expressões cron seguem as regras e são válidas para o node-cron', () => {
    const e = montarExpressoes(regrasBase);
    assert.equal(e.relatorio, '0 7 * * 0,1,2,3,4,5,6');
    assert.equal(e.monitoramento, '*/15 7-18 * * 0,1,2,3,4,5,6');
    assert.equal(cron.validate(e.relatorio), true);
    assert.equal(cron.validate(e.monitoramento), true);
  });

  test('cron acompanha mudança de horário e de dias na configuração', () => {
    const r = structuredClone(regrasBase);
    r.relatorioDiario.horario = '06:45';
    r.diasOperacao = [1, 2, 3, 4, 5];
    assert.equal(montarExpressoes(r).relatorio, '45 6 * * 1,2,3,4,5');
    assert.equal(montarExpressoes(r).monitoramento, '*/15 7-18 * * 1,2,3,4,5');
  });

  test('boot às 09:40 com relatório pendente: envia o relatório imediatamente', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    t.ir(SEGUNDA, '09:40');
    await recuperarBoot(t.ctx);
    assert.equal(t.enviadas.filter((e) => e.tipo === 'relatorio').length, 2);
  });

  test('boot com relatório já enviado: recarrega o estado sem mensagem duplicada', async () => {
    const t = criarCtx({ dir, obras: [obraA], previsao: chuvaA });
    await executarRelatorio(t.ctx);
    const antes = t.enviadas.length;
    // reinício do processo: novo estado lido do mesmo arquivo
    t.ctx.estado = criarEstado(path.join(dir, 'estado.json'));
    t.ir(SEGUNDA, '10:15');
    await recuperarBoot(t.ctx);
    assert.equal(t.enviadas.length, antes);
    assert.equal(t.ctx.estado.getRelatorio(SEGUNDA, 'a').janelas.length, 1);
  });

  test('boot antes do relatório ou à noite não envia nada', async () => {
    for (const [data, hhmm] of [[SEGUNDA, '06:40'], [SEGUNDA, '18:31'], [DOMINGO, '06:00']]) {
      const t = criarCtx({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-test-')), obras: [obraA], previsao: chuvaA });
      t.ir(data, hhmm);
      await recuperarBoot(t.ctx);
      assert.equal(t.enviadas.length, 0, `${data} ${hhmm}`);
    }
  });

  test('boot usa o serializador recebido, um job por vez e na ordem', async () => {
    const t = criarCtx({ dir, obras: [obraB], previsao: (o, d) => diaSeco(d) });
    t.ir(SEGUNDA, '09:00');
    const nomes = [];
    await recuperarBoot(t.ctx, async (nome, fn) => {
      nomes.push(nome);
      await fn();
    });
    assert.deepEqual(nomes, ['relatorio-boot', 'monitoramento-boot']);
  });
});
