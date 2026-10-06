import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { criarEstado, limparAntigos } from '../src/estado.js';

function pastaTemporaria() {
  return mkdtempSync(path.join(tmpdir(), 'estado-test-'));
}

const janelas = () => [
  { inicioMin: 840, fimMin: 960, inicio: '14:00', fim: '16:00', probMax: 80, avisada: false },
];

describe('estado', () => {
  test('grava e relê relatório e janelas pela chave data + obra', () => {
    const dir = pastaTemporaria();
    const arquivo = path.join(dir, 'state', 'estado.json');
    const estado = criarEstado(arquivo);
    estado.setRelatorio('2026-09-21', 'obra-a', { enviadoEm: 123, janelas: janelas() });

    const reaberto = criarEstado(arquivo); // simula reinício do processo
    assert.equal(reaberto.getRelatorio('2026-09-21', 'obra-a').janelas[0].inicio, '14:00');
    assert.equal(reaberto.getRelatorio('2026-09-21', 'obra-b'), null);
    assert.equal(reaberto.getRelatorio('2026-09-22', 'obra-a'), null);
    rmSync(dir, { recursive: true });
  });

  test('marcarAvisada persiste', () => {
    const dir = pastaTemporaria();
    const arquivo = path.join(dir, 'estado.json');
    const estado = criarEstado(arquivo);
    estado.setRelatorio('2026-09-21', 'a', { enviadoEm: 1, janelas: janelas() });
    estado.marcarAvisada('2026-09-21', 'a', 840);
    assert.equal(criarEstado(arquivo).getRelatorio('2026-09-21', 'a').janelas[0].avisada, true);
    rmSync(dir, { recursive: true });
  });

  test('monitor e resumo persistem', () => {
    const dir = pastaTemporaria();
    const arquivo = path.join(dir, 'estado.json');
    const estado = criarEstado(arquivo);
    estado.setMonitor('2026-09-21', 'a', { ultimoImprevistoEm: 5, chovendo: true });
    estado.setResumo('2026-09-21', 99);
    const reaberto = criarEstado(arquivo);
    assert.deepEqual(reaberto.getMonitor('2026-09-21', 'a'), { ultimoImprevistoEm: 5, chovendo: true });
    assert.deepEqual(reaberto.getResumo('2026-09-21'), { enviadoEm: 99 });
    rmSync(dir, { recursive: true });
  });

  test('limpa registros com mais de 7 dias e mantém os recentes', () => {
    const dados = {
      relatorios: { '2026-09-10|a': {}, '2026-09-13|a': {}, '2026-09-14|a': {}, '2026-09-21|a': {} },
      monitoramento: { '2026-09-01|a': {}, '2026-09-20|a': {} },
      resumos: { '2026-09-05': {}, '2026-09-21': {} },
    };
    const removidos = limparAntigos(dados, '2026-09-21', 7);
    // corte = 2026-09-14: mantém 14 em diante
    assert.deepEqual(Object.keys(dados.relatorios), ['2026-09-14|a', '2026-09-21|a']);
    assert.deepEqual(Object.keys(dados.monitoramento), ['2026-09-20|a']);
    assert.deepEqual(Object.keys(dados.resumos), ['2026-09-21']);
    assert.equal(removidos, 4);
  });

  test('limpar() grava o resultado em disco', () => {
    const dir = pastaTemporaria();
    const arquivo = path.join(dir, 'estado.json');
    const estado = criarEstado(arquivo);
    estado.setRelatorio('2026-09-01', 'a', { enviadoEm: 1, janelas: [] });
    estado.setRelatorio('2026-09-21', 'a', { enviadoEm: 1, janelas: [] });
    assert.equal(estado.limpar('2026-09-21', 7), 1);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(arquivo, 'utf8')).relatorios), ['2026-09-21|a']);
    rmSync(dir, { recursive: true });
  });

  test('arquivo corrompido é guardado à parte e o estado recomeça vazio', () => {
    const dir = pastaTemporaria();
    const arquivo = path.join(dir, 'estado.json');
    writeFileSync(arquivo, '{ isto não é json');
    const estado = criarEstado(arquivo);
    assert.equal(estado.getRelatorio('2026-09-21', 'a'), null);
    assert.equal(existsSync(arquivo), false);
    assert.equal(readdirSync(dir).some((f) => f.startsWith('estado.json.corrompido-')), true);
    rmSync(dir, { recursive: true });
  });

  test('gravação não deixa arquivo temporário para trás', () => {
    const dir = pastaTemporaria();
    const estado = criarEstado(path.join(dir, 'estado.json'));
    estado.setResumo('2026-09-21', 1);
    assert.deepEqual(readdirSync(dir), ['estado.json']);
    rmSync(dir, { recursive: true });
  });
});
