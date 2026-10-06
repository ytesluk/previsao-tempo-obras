// Log em arquivo (um por dia, no horário de Brasília) + console.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { partes } from './tempo.js';

const p2 = (n) => String(n).padStart(2, '0');

/**
 * criarLogger({ dir, console: true, relogio })
 * Uso: logger.info('mensagem', { obra: 'x', decisao: 'y' })
 * `dir: null` desliga o arquivo (só console); `console: false` desliga o console.
 */
export function criarLogger({ dir = null, console: usarConsole = true, relogio = () => new Date() } = {}) {
  if (dir) mkdirSync(dir, { recursive: true });

  function registrar(nivel, mensagem, campos) {
    const t = partes(relogio());
    const extra = campos && Object.keys(campos).length ? ` ${JSON.stringify(campos)}` : '';
    const linha = `${t.data} ${p2(t.hora)}:${p2(t.minuto)}:${p2(t.segundo)} ${nivel.padEnd(5)} ${mensagem}${extra}`;
    if (usarConsole) (nivel === 'ERRO' ? console.error : nivel === 'WARN' ? console.warn : console.log)(linha);
    if (dir) {
      try {
        appendFileSync(path.join(dir, `${t.data}.log`), `${linha}\n`);
      } catch (e) {
        console.error(`Falha ao escrever o log: ${e.message}`);
      }
    }
  }

  return {
    info: (mensagem, campos) => registrar('INFO', mensagem, campos),
    warn: (mensagem, campos) => registrar('WARN', mensagem, campos),
    erro: (mensagem, campos) => registrar('ERRO', mensagem, campos),
  };
}
