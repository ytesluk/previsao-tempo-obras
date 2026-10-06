import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Fila } from '../src/notificador/fila.js';
import { NotificadorConsole } from '../src/notificador/console.js';

describe('Fila', () => {
  test('entrega na ordem de chegada', () => {
    const f = new Fila();
    f.adicionar({ destino: 'a', mensagem: '1', validoAte: null });
    f.adicionar({ destino: 'b', mensagem: '2', validoAte: null });
    assert.equal(f.proximo(0).item.mensagem, '1');
    assert.equal(f.proximo(0).item.mensagem, '2');
    assert.equal(f.proximo(0).item, null);
  });

  test('descarta alertas vencidos e entrega o próximo válido', () => {
    const f = new Fila();
    f.adicionar({ destino: 'a', mensagem: 'vencida', validoAte: 1000 });
    f.adicionar({ destino: 'a', mensagem: 'valida', validoAte: 5000 });
    const { item, descartados } = f.proximo(2000);
    assert.equal(item.mensagem, 'valida');
    assert.deepEqual(descartados.map((d) => d.mensagem), ['vencida']);
  });

  test('validade nula nunca vence; limite exato ainda vale', () => {
    const f = new Fila();
    f.adicionar({ destino: 'a', mensagem: 'sem limite', validoAte: null });
    f.adicionar({ destino: 'a', mensagem: 'no limite', validoAte: 1000 });
    assert.equal(f.proximo(10 ** 12).item.mensagem, 'sem limite');
    assert.equal(f.proximo(1000).item.mensagem, 'no limite');
  });

  test('devolver recoloca no início', () => {
    const f = new Fila();
    f.adicionar({ destino: 'a', mensagem: '1', validoAte: null });
    f.adicionar({ destino: 'a', mensagem: '2', validoAte: null });
    const { item } = f.proximo(0);
    f.devolver(item);
    assert.equal(f.tamanho, 2);
    assert.equal(f.proximo(0).item.mensagem, '1');
  });

  test('fila só de vencidas devolve item nulo e a lista de descartes', () => {
    const f = new Fila();
    f.adicionar({ destino: 'a', mensagem: 'x', validoAte: 1 });
    const r = f.proximo(2);
    assert.equal(r.item, null);
    assert.equal(r.descartados.length, 1);
    assert.equal(f.tamanho, 0);
  });
});

describe('NotificadorConsole', () => {
  test('imprime destino e texto e não envia nada', async () => {
    const linhas = [];
    const n = new NotificadorConsole({ saida: (l) => linhas.push(l) });
    const r = await n.enviar('123@g.us', 'olá\nmundo', { tipo: 'relatorio', obraId: 'a' });
    assert.equal(r.status, 'simulada');
    assert.match(linhas[0], /\[DRY_RUN\] relatorio → 123@g\.us \(obra a\)/);
    assert.match(linhas[0], /\| olá\n {2}\| mundo/);
  });
});
