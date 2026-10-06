// Fila de mensagens pendentes. Cada item tem validade: alerta vencido é descartado, nunca enviado tarde.
export class Fila {
  #itens = [];

  /** item = { destino, mensagem, validoAte (ms|null), ...metadados } */
  adicionar(item) {
    this.#itens.push({ tentativas: 0, criadoEm: Date.now(), ...item });
  }

  /** Próximo item ainda válido. Itens vencidos encontrados no caminho vêm em `descartados`. */
  proximo(agoraMs) {
    const descartados = [];
    while (this.#itens.length > 0) {
      const item = this.#itens.shift();
      if (item.validoAte != null && agoraMs > item.validoAte) descartados.push(item);
      else return { item, descartados };
    }
    return { item: null, descartados };
  }

  /** Devolve um item ao início da fila (por exemplo, após queda de conexão). */
  devolver(item) {
    this.#itens.unshift(item);
  }

  get tamanho() {
    return this.#itens.length;
  }
}
