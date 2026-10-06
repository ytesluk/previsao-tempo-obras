// Adaptador DRY_RUN: não envia nada, só imprime e registra o que seria enviado.
export class NotificadorConsole {
  nome = 'console';

  constructor({ logger = null, saida = (linha) => console.log(linha) } = {}) {
    this.logger = logger;
    this.saida = saida;
  }

  async iniciar() {}

  async enviar(destino, mensagem, { tipo = 'mensagem', obraId = null } = {}) {
    this.saida(`\n[DRY_RUN] ${tipo} → ${destino}${obraId ? ` (obra ${obraId})` : ''}\n${mensagem.replace(/^/gm, '  | ')}`);
    return { status: 'simulada' };
  }

  async aguardarEnvios() {}

  async encerrar() {}
}
