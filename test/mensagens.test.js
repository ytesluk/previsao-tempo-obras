import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatarHora,
  mensagemAproximacao,
  mensagemChuvaParou,
  mensagemImprevisto,
  mensagemRelatorio,
  mensagemResumo,
  saudacao,
} from '../src/mensagens.js';

const regras = JSON.parse(readFileSync(new URL('../config/regras.json', import.meta.url), 'utf8'));
const obra = { id: 'a', nome: 'Bloco ADM CIC' };
const DATA = '2026-09-25'; // sexta-feira
const janela = (ini, fim, mmMax = 2, forte = false) => ({ inicioMin: ini * 60, fimMin: fim * 60, mmMax, forte });
const relatorio = (janelas, extra = {}) => mensagemRelatorio({ obra, janelas, hora: 7, data: DATA, regras, ...extra });

describe('relatório diário', () => {
  test('sem chuva prevista não gera mensagem nenhuma', () => {
    assert.equal(relatorio([]), null);
  });

  test('com chuva: título, data, janela e volume', () => {
    assert.equal(
      relatorio([janela(14, 16, 3)]),
      '🌧️ *PREVISÃO DE CHUVA — BLOCO ADM CIC*🌧️\n' +
        '_Bom dia! sexta-feira, 25/09_\n' +
        '\n' +
        '🟠 *14h às 16h* — chuva moderada (até 3 mm/h)\n' +
        '\n' +
        '_Você receberá um novo aviso 1 hora antes._',
    );
  });

  test('uma linha por janela, com chuva forte sinalizada', () => {
    const linhas = relatorio([janela(9, 10, 1.2), janela(14, 16, 6, true)]).split('\n');
    assert.equal(linhas[3], '🟡 *9h às 10h* — chuva fraca (até 1,2 mm/h)');
    assert.equal(linhas[4], '🔴 *14h às 16h* — chuva forte (até 6 mm/h)');
  });

  test('volume zero não vira "até 0 mm/h"', () => {
    assert.match(relatorio([janela(14, 16, 0)]), /\*14h às 16h\* — garoa\n/);
  });

  test('janela já encerrada é omitida; se todas passaram, não manda nada', () => {
    const m = relatorio([janela(6, 7), janela(14, 16)], { agoraMin: 8 * 60 });
    assert.doesNotMatch(m, /6h às 7h/);
    assert.match(m, /14h às 16h/);
    assert.equal(relatorio([janela(6, 7)], { agoraMin: 8 * 60 }), null);
  });

  test('janela em andamento continua sendo anunciada', () => {
    assert.match(relatorio([janela(8, 10)], { agoraMin: 9 * 60 }), /8h às 10h/);
  });

  test('saudação acompanha a hora do envio', () => {
    assert.equal(saudacao(7), 'Bom dia');
    assert.equal(saudacao(13), 'Boa tarde');
    assert.match(relatorio([janela(14, 16)], { hora: 13 }), /_Boa tarde! sexta-feira, 25\/09_/);
  });

  test('não fala em probabilidade nem na palavra "obra"', () => {
    const m = relatorio([janela(14, 16)]);
    assert.doesNotMatch(m, /prob/i);
    assert.doesNotMatch(m, /\bobra\b/i);
  });
});

describe('alertas', () => {
  test('aproximação traz horário e volume', () => {
    assert.equal(
      mensagemAproximacao({ obra, janela: janela(14, 16, 3), regras }),
      '⏰ *CHUVA EM 1 HORA — BLOCO ADM CIC*\n\nComeça às *14h* e vai até *16h*\n🟠 Previsão de chuva moderada (até 3 mm/h)',
    );
  });

  test('aproximação sinaliza chuva forte e omite volume zero', () => {
    const m = mensagemAproximacao({ obra, janela: janela(14, 16, 0), regras });
    assert.doesNotMatch(m, /mm\/h/, 'volume zero não mostra "até 0 mm/h"');
    assert.match(m, /💧 Previsão de garoa/);
  });

  test('imprevisto agora', () => {
    assert.equal(
      mensagemImprevisto({ obra, tipo: 'agora' }),
      '🚨 *CHUVA NÃO PREVISTA — BLOCO ADM CIC*\n\nChovendo *agora*\n\n_Não constava na previsão de hoje._',
    );
  });

  test('imprevisto futuro com e sem horário estimado', () => {
    assert.match(mensagemImprevisto({ obra, tipo: 'proximos', inicioPrevistoMin: 625 }), /Início previsto: \*10h25\*/);
    assert.match(mensagemImprevisto({ obra, tipo: 'proximos' }), /Início previsto: \*na próxima hora\*/);
  });

  test('chuva parou', () => {
    assert.equal(mensagemChuvaParou({ obra }), '✅ *BLOCO ADM CIC*\n\nA chuva parou.');
  });

  test('formatarHora', () => {
    assert.equal(formatarHora(14 * 60), '14h');
    assert.equal(formatarHora(14 * 60 + 30), '14h30');
  });
});

describe('resumo diário por região', () => {
  const resumo = (itens) => mensagemResumo({ data: DATA, itens, regras });
  const cidade = (nome, regiao, janelas) => ({ obra: { nome, regiao }, janelas });

  test('agrupa as cidades numa linha por região, com a lista embaixo', () => {
    const m = resumo([
      cidade('Colombo', 'Região de Curitiba', [janela(14, 16, 3)]),
      cidade('Pinhais', 'Região de Curitiba', [janela(17, 19, 1)]),
    ]);
    assert.match(m, /🟠 \*Região de Curitiba\* — tarde e fim da tarde\n_Colombo, Pinhais_/);
  });

  test('a região herda o pior nível entre suas cidades', () => {
    const m = resumo([
      cidade('Colombo', 'Região de Curitiba', [janela(14, 16, 1)]),
      cidade('Pinhais', 'Região de Curitiba', [janela(14, 16, 9)]),
    ]);
    assert.match(m, /🔴 \*Região de Curitiba\*/);
  });

  test('região com uma cidade de mesmo nome não repete a lista', () => {
    const m = resumo([cidade('Curitiba', 'Curitiba', [janela(14, 16, 3)])]);
    assert.match(m, /🟠 \*Curitiba\* — tarde$/m);
    assert.doesNotMatch(m, /_Curitiba_/);
  });

  test('mais crítico primeiro', () => {
    const m = resumo([
      cidade('Toledo', 'Oeste', [janela(14, 16, 1)]),
      cidade('Palmas', 'Sudoeste', [janela(14, 16, 6)]),
      cidade('Curitiba', 'Curitiba', [janela(14, 16, 3)]),
    ]);
    const ordem = [...m.matchAll(/\*(Oeste|Sudoeste|Curitiba)\*/g)].map((x) => x[1]);
    assert.deepEqual(ordem, ['Sudoeste', 'Curitiba', 'Oeste']);
  });

  test('cidade sem chuva não aparece', () => {
    const m = resumo([cidade('Palmas', 'Sudoeste', [janela(14, 16, 6)]), cidade('Toledo', 'Oeste', [])]);
    assert.doesNotMatch(m, /Oeste|Toledo/);
  });

  test('períodos: manhã, tarde, fim da tarde e o dia todo', () => {
    const p = (ini, fim) => resumo([cidade('X', 'R', [janela(ini, fim, 3)])]).match(/\*R\* — ([^\n]+)/)[1];
    assert.equal(p(8, 11), 'manhã');
    assert.equal(p(13, 16), 'tarde');
    assert.equal(p(17, 19), 'fim da tarde');
    assert.equal(p(8, 19), 'o dia todo');
    assert.equal(p(10, 14), 'manhã e tarde');
  });

  test('previsão indisponível vira uma linha no fim', () => {
    const m = resumo([cidade('Palmas', 'Sudoeste', [janela(14, 16, 6)]), { obra: { nome: 'Loanda' }, indisponivel: true }]);
    assert.match(m, /⚠️ \*Sem previsão disponível\* — Loanda$/);
  });

  test('ninguém com chuva: nenhuma mensagem', () => {
    assert.equal(resumo([cidade('Palmas', 'Sudoeste', []), cidade('Toledo', 'Oeste', [])]), null);
  });
});
