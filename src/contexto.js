// Monta o contexto compartilhado (config, estado, clima, notificador, logger) e roda scripts avulsos.
import { carregarConfig } from './config.js';
import { criarClima } from './clima.js';
import { criarEstado } from './estado.js';
import { criarLogger } from './logger.js';
import { criarNotificador } from './notificador/index.js';

export async function criarContexto({ config = carregarConfig() } = {}) {
  const logger = criarLogger({ dir: config.caminhos.logs });
  return {
    config,
    obras: config.obras,
    geral: config.geral,
    regras: config.regras,
    logger,
    estado: criarEstado(config.caminhos.estado, { logger }),
    clima: criarClima({ logger, modelos: config.regras.modelos ?? [] }),
    notificador: await criarNotificador({ env: config.env, caminhos: config.caminhos, logger }),
    agora: () => new Date(),
  };
}

/**
 * Executa `fn(ctx, argumentos)` com o contexto real, espera os envios terminarem,
 * encerra a conexão e sai com código 0 (ok) ou 1 (erro).
 */
export async function rodarScript(fn) {
  let ctx;
  let codigo = 0;
  try {
    ctx = await criarContexto();
    await ctx.notificador.iniciar();
    await fn(ctx, process.argv.slice(2));
    await ctx.notificador.aguardarEnvios();
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    codigo = 1;
  } finally {
    await ctx?.notificador.encerrar();
  }
  sairComCodigo(codigo);
}

/**
 * Sai deixando o Node esvaziar o event loop sozinho: chamar process.exit() logo após um fetch
 * derruba o libuv no Windows (Assertion failed: UV_HANDLE_CLOSING) e devolve código de saída de erro.
 * O process.exit adiado só existe para o caso de algo (ex.: socket do WhatsApp) segurar o processo.
 */
export function sairComCodigo(codigo) {
  process.exitCode = codigo;
  setTimeout(() => process.exit(codigo), 3000).unref();
}
