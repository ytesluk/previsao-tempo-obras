// Envio a uma lista de destinos, com log e sem deixar a falha de um grupo derrubar os outros.
/** Devolve quantos destinos aceitaram a mensagem (enviada ou enfileirada). */
export async function enviarParaDestinos(ctx, { destinos, texto, tipo, obraId = null, validoAte = null }) {
  let aceitas = 0;
  for (const destino of destinos) {
    try {
      const { status } = await ctx.notificador.enviar(destino, texto, { validoAte, tipo, obraId });
      aceitas += 1;
      ctx.logger.info(`Mensagem ${tipo}: ${status}`, { obra: obraId, destino, texto });
    } catch (e) {
      ctx.logger.erro(`Falha ao enviar ${tipo}: ${e.message}`, { obra: obraId, destino });
    }
  }
  return aceitas;
}
