// npm run listar-grupos
// Conecta ao WhatsApp e lista nome + ID dos grupos em que o número do robô participa.
// Pare o serviço antes (pm2 stop previsao-tempo-obras): duas conexões com a mesma sessão se derrubam.
import { carregarConfig } from '../src/config.js';
import { sairComCodigo } from '../src/contexto.js';
import { criarLogger } from '../src/logger.js';
import { NotificadorBaileys } from '../src/notificador/baileys.js';

const config = carregarConfig();
const logger = criarLogger({ dir: config.caminhos.logs });
// Espera mais que o normal: na primeira vez é preciso escanear o QR Code
const whatsapp = new NotificadorBaileys({ authDir: config.caminhos.auth, logger, aguardarConexaoMs: 5 * 60 * 1000 });

let codigo = 0;
try {
  await whatsapp.iniciar();
  if (!whatsapp.pronto) throw new Error('Não conectou ao WhatsApp a tempo. Escaneie o QR Code ou verifique a internet e tente de novo.');

  const grupos = Object.values(await whatsapp.socket.groupFetchAllParticipating()).sort((a, b) =>
    (a.subject ?? '').localeCompare(b.subject ?? '', 'pt-BR'),
  );
  console.log(`\nGrupos em que este número participa (${grupos.length}):\n`);
  for (const g of grupos) console.log(`  ${g.subject}\n    ${g.id}\n`);
  console.log('Copie o ID (termina em @g.us) para o campo "destinos" de config/obras.json.');
} catch (e) {
  console.error(`Erro: ${e.message}`);
  codigo = 1;
} finally {
  await whatsapp.encerrar();
}
sairComCodigo(codigo);
