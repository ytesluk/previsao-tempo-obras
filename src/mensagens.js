// Montagem dos textos enviados. Funções puras.
// Formatação do WhatsApp: *negrito*, _itálico_. Nada de imagem: a prévia da notificação
// no celular mostra o texto, e uma imagem apareceria como "📷 Foto" sem a informação.
import { NOMES_DIAS, diaDaSemana, formatarDataBR } from './tempo.js';

export function saudacao(hora) {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** 840 -> "14h"; 870 -> "14h30". */
export function formatarHora(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

const formatarMm = (mm) => String(Number(mm.toFixed(1))).replace('.', ',');

/**
 * Fraca / moderada / forte pelo volume previsto, usando os limiares da configuração.
 * `tempestade` vem do código do tempo (95/96/99) e vale mesmo com pouco volume:
 * raio e vento importam para trabalho em altura, não só o quanto vai molhar.
 */
export function classificarIntensidade(mm, regras, tempestade = false) {
  if (tempestade) return { rotulo: 'tempestade', icone: '⛈️', gravidade: 4 };
  if (mm >= regras.chuva.chuvaForteMm) return { rotulo: 'chuva forte', icone: '🔴', gravidade: 3 };
  if (mm >= regras.chuva.chuvaModeradaMm) return { rotulo: 'chuva moderada', icone: '🟠', gravidade: 2 };
  if (mm >= (regras.chuva.garoaMaximaMm ?? 0)) return { rotulo: 'chuva fraca', icone: '🟡', gravidade: 1 };
  return { rotulo: 'garoa', icone: '💧', gravidade: 0 };
}

/** Legenda no topo da mensagem, para quem não conhece os ícones. */
export function legenda(regras) {
  const chuva = regras.chuva;
  const { chuvaModeradaMm, chuvaForteMm } = chuva;
  return [
    '⛈️ Tempestade',
    `🔴 Chuva forte (${chuvaForteMm}+ mm/h)`,
    `🟠 Chuva moderada (${String(chuvaModeradaMm).replace('.', ',')} a ${chuvaForteMm} mm/h)`,
    `🟡 Chuva fraca (${String(chuva.garoaMaximaMm ?? 0).replace('.', ',')} a ${String(chuvaModeradaMm).replace('.', ',')} mm/h)`,
    '💧 Garoa',
  ].join('\n');
}

/** "🔴 *14h às 16h* — chuva forte (até 6 mm/h)" */
function linhaJanela(j, regras) {
  const { rotulo, icone } = classificarIntensidade(j.mmMax, regras, j.tempestade);
  const volume = j.mmMax > 0 ? ` (até ${formatarMm(j.mmMax)} mm/h)` : '';
  return `${icone} *${formatarHora(j.inicioMin)} às ${formatarHora(j.fimMin)}* — ${rotulo}${volume}`;
}

export function descreverJanelas(janelas) {
  const textos = janelas.map((j) => `${formatarHora(j.inicioMin)} às ${formatarHora(j.fimMin)}`);
  if (textos.length <= 1) return textos.join('');
  return `${textos.slice(0, -1).join(', ')} e ${textos[textos.length - 1]}`;
}

/**
 * Descarta janelas que já terminaram: num relatório atrasado (o computador ligou depois das 07:00)
 * não adianta anunciar chuva das 6h às 7h. Devolve { vigentes, houvePassadas }.
 */
export function janelasVigentes(janelas, agoraMin = 0) {
  const vigentes = janelas.filter((j) => j.fimMin > agoraMin);
  return { vigentes, houvePassadas: vigentes.length < janelas.length };
}

/** Devolve null quando não há chuva a comunicar (o job então não envia nada). */
export function mensagemRelatorio({ obra, janelas, hora, data, regras, agoraMin = 0 }) {
  const { vigentes } = janelasVigentes(janelas, agoraMin);
  if (vigentes.length === 0) return null;
  return [
    `🌧️ *PREVISÃO DE CHUVA — ${obra.nome.toUpperCase()}*🌧️`,
    `_${saudacao(hora)}! ${NOMES_DIAS[diaDaSemana(data)]}, ${formatarDataBR(data)}_`,
    '',
    ...vigentes.map((j) => linhaJanela(j, regras)),
    '',
    '_Você receberá um novo aviso 1 hora antes._',
  ].join('\n');
}

export function mensagemAproximacao({ obra, janela, regras }) {
  const { rotulo, icone } = classificarIntensidade(janela.mmMax, regras, janela.tempestade);
  return [
    `⏰ *CHUVA EM 1 HORA — ${obra.nome.toUpperCase()}*`,
    '',
    `Começa às *${formatarHora(janela.inicioMin)}* e vai até *${formatarHora(janela.fimMin)}*`,
    `${icone} Previsão de ${rotulo}${janela.mmMax > 0 ? ` (até ${formatarMm(janela.mmMax)} mm/h)` : ''}`,
  ].join('\n');
}

/** `inicioPrevistoMin` (só no tipo "proximos") é o horário estimado em que a chuva começa. */
export function mensagemImprevisto({ obra, tipo, inicioPrevistoMin = null }) {
  const quando =
    tipo === 'agora'
      ? 'Chovendo *agora*'
      : inicioPrevistoMin == null
        ? 'Início previsto: *na próxima hora*'
        : `Início previsto: *${formatarHora(inicioPrevistoMin)}*`;
  return [`🚨 *CHUVA NÃO PREVISTA — ${obra.nome.toUpperCase()}*`, '', quando, '', '_Não constava na previsão de hoje._'].join('\n');
}

export function mensagemChuvaParou({ obra }) {
  return `✅ *${obra.nome.toUpperCase()}*\n\nA chuva parou.`;
}

/**
 * Resumo consolidado das 07:00, só com os locais que têm chuva prevista.
 * itens = [{ obra, janelas }] ou [{ obra, indisponivel: true }]
 * Devolve null quando não há nada a comunicar.
 */
/** O endereço só aparece quando a cidade tem mais de uma unidade: senão o nome já basta. */
function precisaEndereco(obra, itens) {
  if (!obra.endereco || !obra.cidade) return false;
  return itens.filter((i) => i.obra.cidade === obra.cidade).length > 1;
}

const maiusculaInicial = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Períodos do dia que as janelas alcançam: manhã (até 12h), tarde (12h–17h), fim da tarde (17h em diante). */
export function periodos(janelas) {
  const faixas = [
    ['manhã', 0, 12 * 60],
    ['tarde', 12 * 60, 17 * 60],
    ['fim da tarde', 17 * 60, 24 * 60],
  ];
  const tocados = faixas.filter(([, ini, fim]) => janelas.some((j) => j.inicioMin < fim && j.fimMin > ini)).map(([n]) => n);
  if (tocados.length === 3) return 'o dia todo';
  if (tocados.length === 2) return `${tocados[0]} e ${tocados[1]}`;
  return tocados[0] ?? '';
}

const porNome = (a, b) => a.localeCompare(b, 'pt-BR');

/** Uma linha por região, com o pior nível da região e a união dos períodos. */
export function mensagemResumo({ data, itens, regras, agoraMin = 0 }) {
  const grupos = new Map();
  const semPrevisao = [];
  for (const { obra, janelas, indisponivel } of itens) {
    if (indisponivel) {
      semPrevisao.push(obra.nome);
      continue;
    }
    const { vigentes } = janelasVigentes(janelas, agoraMin);
    if (vigentes.length === 0) continue;
    const mm = Math.max(...vigentes.map((j) => j.mmMax));
    const { icone, gravidade } = classificarIntensidade(mm, regras, vigentes.some((j) => j.tempestade));
    const regiao = obra.regiao ?? obra.nome;
    const g = grupos.get(regiao) ?? { regiao, cidades: [], janelas: [], gravidade: 0, icone, mm: 0 };
    g.cidades.push(obra.nome);
    g.janelas.push(...vigentes);
    if (gravidade > g.gravidade) ({ icone: g.icone, gravidade: g.gravidade } = { icone, gravidade });
    g.mm = Math.max(g.mm, mm);
    grupos.set(regiao, g);
  }
  if (grupos.size === 0 && semPrevisao.length === 0) return null;

  const blocos = [...grupos.values()]
    .sort((a, b) => b.gravidade - a.gravidade || b.mm - a.mm || porNome(a.regiao, b.regiao))
    .map((g) => {
      const cabecalho = `${g.icone} *${g.regiao}* — ${periodos(g.janelas)}`;
      // região de uma cidade só com o mesmo nome não precisa repetir a lista
      const cidades = g.cidades.sort(porNome);
      return cidades.length === 1 && cidades[0] === g.regiao ? cabecalho : `${cabecalho}\n_${cidades.join(', ')}_`;
    });
  if (semPrevisao.length) blocos.push(`⚠️ *Sem previsão disponível* — ${semPrevisao.sort(porNome).join(', ')}`);
  // deixa claro que as demais foram consultadas e estão limpas, não que o robô falhou
  const semChuva = itens.length - [...grupos.values()].reduce((n, g) => n + g.cidades.length, 0) - semPrevisao.length;
  if (semChuva > 0) blocos.push(`_Demais ${semChuva} ${semChuva === 1 ? 'unidade' : 'unidades'} sem chuva prevista._`);
  return [`*PREVISÃO DE CHUVA — ${formatarDataBR(data)}*`, '', legenda(regras), '', blocos.join('\n\n')].join('\n');
}

/** Um aviso só para todas as unidades cuja chuva começa dentro de 1 hora. */
export function mensagemAproximacaoConsolidada({ itens, regras }) {
  if (itens.length === 0) return null;
  const blocos = itens.map(({ obra, janela }) => {
    const { rotulo } = classificarIntensidade(janela.mmMax, regras, janela.tempestade);
    const linha = `⏰ *${obra.nome}* — ${formatarHora(janela.inicioMin)} às ${formatarHora(janela.fimMin)} (${maiusculaInicial(rotulo)})`;
    return precisaEndereco(obra, itens) ? `${linha}\n_${obra.endereco}_` : linha;
  });
  return ['*CHUVA EM 1 HORA*', '*UNIDADES SESI/SENAI:*', '', blocos.join('\n\n')].join('\n');
}

/** Um aviso só para todas as unidades com chuva fora do previsto. */
export function mensagemImprevistoConsolidada({ itens }) {
  if (itens.length === 0) return null;
  const blocos = itens.map(({ obra, tipo, inicioPrevistoMin }) => {
    const quando = tipo === 'agora' ? 'chovendo agora' : inicioPrevistoMin == null ? 'na próxima hora' : `a partir das ${formatarHora(inicioPrevistoMin)}`;
    const linha = `🚨 *${obra.nome}* — ${quando}`;
    return precisaEndereco(obra, itens) ? `${linha}\n_${obra.endereco}_` : linha;
  });
  return ['*CHUVA NÃO PREVISTA*', '*UNIDADES SESI/SENAI:*', '', blocos.join('\n\n')].join('\n');
}
