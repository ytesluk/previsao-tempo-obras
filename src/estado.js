// Leitura e escrita de state/estado.json (gravação atômica). Sobrevive a reinícios e boots atrasados.
//
// Formato:
// {
//   "relatorios":   { "AAAA-MM-DD|obraId": { enviadoEm, janelas: [...] } },
//   "monitoramento": { "AAAA-MM-DD|obraId": { ultimoImprevistoEm, chovendo } },
//   "resumos":      { "AAAA-MM-DD": { enviadoEm } }
// }
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { somarDias } from './tempo.js';

const vazio = () => ({ versao: 1, relatorios: {}, monitoramento: {}, resumos: {} });
const chave = (data, obraId) => `${data}|${obraId}`;

/** Remove registros com mais de `dias` dias. Devolve quantos removeu. Pura em relação ao disco. */
export function limparAntigos(dados, hoje, dias) {
  const corte = somarDias(hoje, -dias);
  let removidos = 0;
  for (const secao of ['relatorios', 'monitoramento', 'resumos']) {
    for (const k of Object.keys(dados[secao])) {
      if (k.slice(0, 10) < corte) {
        delete dados[secao][k];
        removidos++;
      }
    }
  }
  return removidos;
}

export function criarEstado(arquivo, { logger = null } = {}) {
  let dados = carregar();

  function carregar() {
    if (!existsSync(arquivo)) return vazio();
    try {
      const lido = JSON.parse(readFileSync(arquivo, 'utf8'));
      return { ...vazio(), ...lido };
    } catch (e) {
      const backup = `${arquivo}.corrompido-${Date.now()}`;
      renameSync(arquivo, backup);
      logger?.erro(`estado.json ilegível (${e.message}); guardado em ${backup} e recomeçando vazio`);
      return vazio();
    }
  }

  function salvar() {
    mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = `${arquivo}.tmp`;
    writeFileSync(temporario, JSON.stringify(dados, null, 2));
    renameSync(temporario, arquivo);
  }

  return {
    arquivo,
    /** Devolve os dados crus (útil para diagnóstico e testes). */
    dados: () => dados,

    getRelatorio: (data, obraId) => dados.relatorios[chave(data, obraId)] ?? null,
    setRelatorio(data, obraId, { enviadoEm, janelas }) {
      dados.relatorios[chave(data, obraId)] = { enviadoEm, janelas };
      salvar();
    },
    marcarAvisada(data, obraId, inicioMin) {
      const rel = dados.relatorios[chave(data, obraId)];
      const janela = rel?.janelas.find((j) => j.inicioMin === inicioMin);
      if (janela) {
        janela.avisada = true;
        salvar();
      }
    },

    getMonitor: (data, obraId) => dados.monitoramento[chave(data, obraId)] ?? null,
    setMonitor(data, obraId, valor) {
      dados.monitoramento[chave(data, obraId)] = valor;
      salvar();
    },

    getResumo: (data) => dados.resumos[data] ?? null,
    setResumo(data, enviadoEm) {
      dados.resumos[data] = { enviadoEm };
      salvar();
    },

    limpar(hoje, dias) {
      const removidos = limparAntigos(dados, hoje, dias);
      if (removidos > 0) salvar();
      return removidos;
    },
  };
}
