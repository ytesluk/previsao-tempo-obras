// Fábrica do notificador. Interface comum: iniciar(), enviar(destino, mensagem, opcoes), aguardarEnvios(), encerrar().
// O baileys é carregado sob demanda: em DRY_RUN nem precisa estar instalado/conectado.
import { NotificadorConsole } from './console.js';

export async function criarNotificador({ env, caminhos, logger }) {
  const usarConsole = env.dryRun || env.notificador !== 'baileys';
  if (usarConsole) {
    const motivo = env.dryRun ? 'DRY_RUN=true' : `NOTIFICADOR=${env.notificador}`;
    logger.info(`Notificador: console (${motivo}). NENHUMA mensagem será enviada ao WhatsApp.`);
    return new NotificadorConsole({ logger });
  }
  const { NotificadorBaileys } = await import('./baileys.js');
  logger.info('Notificador: baileys (envio REAL pelo WhatsApp)');
  return new NotificadorBaileys({
    authDir: caminhos.auth,
    logger,
    aguardarConexaoMs: env.conexaoTimeoutS * 1000,
  });
}
