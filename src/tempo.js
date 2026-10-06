// Datas e horas sempre no fuso de Brasília, sem depender do fuso do computador.
export const TIMEZONE = 'America/Sao_Paulo';

const formatador = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const DIAS_ABREV = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Decompõe um instante (Date) em data/hora de Brasília. */
export function partes(date = new Date()) {
  const p = Object.fromEntries(formatador.formatToParts(date).map((x) => [x.type, x.value]));
  const hora = Number(p.hour);
  const minuto = Number(p.minute);
  return {
    data: `${p.year}-${p.month}-${p.day}`,
    hora,
    minuto,
    segundo: Number(p.second),
    minutos: hora * 60 + minuto,
    diaSemana: DIAS_ABREV[p.weekday],
  };
}

export function hhmmParaMin(texto) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(texto));
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) {
    throw new Error(`Horário inválido: "${texto}" (use HH:MM)`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minParaHhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 0 = domingo ... 6 = sábado, para uma data "AAAA-MM-DD". */
export function diaDaSemana(data) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function somarDias(data, n) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function formatarDataBR(data) {
  const [, m, d] = data.split('-');
  return `${d}/${m}`;
}

/** "2026-09-21T14:00" (horário local, como o Open-Meteo devolve) -> { data, hora, minutos }. */
export function lerIsoLocal(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) throw new Error(`Data/hora inválida: "${iso}"`);
  const hora = Number(m[2]);
  return { data: m[1], hora, minutos: hora * 60 + Number(m[3]) };
}

/** Instante (ms) de hoje no horário HH:MM, a partir de "agora". */
export function instanteHoje(agora, hhmm) {
  const t = partes(agora);
  return agora.getTime() + (hhmmParaMin(hhmm) - t.minutos) * 60000 - t.segundo * 1000;
}
