export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom' | 'all';

export interface PeriodState {
  kind: PeriodKind;
  /** Data âncora local no formato YYYY-MM-DD para Dia/Semana/Mês/Ano */
  anchor: string;
  /** Data inicial YYYY-MM-DD (vazia quando kind === 'all') */
  from: string;
  /** Data final YYYY-MM-DD (vazia quando kind === 'all') */
  to: string;
}

const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const MONTH_SHORT_PT = [
  'jan.',
  'fev.',
  'mar.',
  'abr.',
  'mai.',
  'jun.',
  'jul.',
  'ago.',
  'set.',
  'out.',
  'nov.',
  'dez.',
];

const WEEKDAY_SHORT_PT = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

/**
 * Converte um objeto Date para string local YYYY-MM-DD sem usar toISOString()
 * (evita deslocamento de fuso horário após 21h em America/Sao_Paulo).
 */
export function toLocalISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Faz o parse de uma string YYYY-MM-DD para componentes locais { year, month, day } (month 1..12).
 */
export function parseLocalISODate(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
  }
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  };
}

export function dateFromLocalISO(iso: string): Date {
  const { year, month, day } = parseLocalISODate(iso);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(year, month1to12, 0).getDate();
}

export function addDaysISO(iso: string, deltaDays: number): string {
  const d = dateFromLocalISO(iso);
  d.setDate(d.getDate() + deltaDays);
  return toLocalISODate(d);
}

export function addMonthsISO(iso: string, deltaMonths: number): string {
  const { year, month, day } = parseLocalISODate(iso);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;
  const targetMonth1 = targetMonth0 + 1;
  const maxDay = daysInMonth(targetYear, targetMonth1);
  const clampedDay = Math.min(day, maxDay);
  return `${targetYear}-${String(targetMonth1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function addYearsISO(iso: string, deltaYears: number): string {
  return addMonthsISO(iso, deltaYears * 12);
}

/**
 * Retorna o intervalo [from, to] da semana iniciando na Segunda-feira (ISO-8601, DA-8 = A)
 * e terminando no Domingo.
 */
export function getISOWeekRange(anchorISO: string): { from: string; to: string } {
  const d = dateFromLocalISO(anchorISO);
  const dow = d.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDaysISO(anchorISO, offsetToMonday);
  const sunday = addDaysISO(monday, 6);
  return { from: monday, to: sunday };
}

export function getMonthRange(anchorISO: string): { from: string; to: string } {
  const { year, month } = parseLocalISODate(anchorISO);
  const lastDay = daysInMonth(year, month);
  const mm = String(month).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function getYearRange(anchorISO: string): { from: string; to: string } {
  const { year } = parseLocalISODate(anchorISO);
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };
}

/**
 * Constrói um PeriodState consistente para o modo e a data âncora informados.
 * Padrão do sistema (DA-6 = A): mês corrente ('month').
 */
export function buildPeriodState(
  kind: PeriodKind = 'month',
  anchorISO: string = toLocalISODate(),
  customRange?: { from: string; to: string },
): PeriodState {
  if (kind === 'day') {
    return { kind, anchor: anchorISO, from: anchorISO, to: anchorISO };
  }
  if (kind === 'week') {
    const { from, to } = getISOWeekRange(anchorISO);
    return { kind, anchor: anchorISO, from, to };
  }
  if (kind === 'month') {
    const { from, to } = getMonthRange(anchorISO);
    return { kind, anchor: anchorISO, from, to };
  }
  if (kind === 'year') {
    const { from, to } = getYearRange(anchorISO);
    return { kind, anchor: anchorISO, from, to };
  }
  if (kind === 'custom') {
    const fallback = getMonthRange(anchorISO);
    const from = customRange?.from || fallback.from;
    const to = customRange?.to || fallback.to;
    return {
      kind,
      anchor: from,
      from: from <= to ? from : to,
      to: from <= to ? to : from,
    };
  }
  // kind === 'all'
  return { kind: 'all', anchor: anchorISO, from: '', to: '' };
}

/**
 * Avança (direction = 1) ou recua (direction = -1) o período atual.
 */
export function shiftPeriod(state: PeriodState, direction: -1 | 1): PeriodState {
  if (state.kind === 'day') {
    const nextAnchor = addDaysISO(state.anchor, direction);
    return buildPeriodState('day', nextAnchor);
  }
  if (state.kind === 'week') {
    const nextAnchor = addDaysISO(state.anchor, direction * 7);
    return buildPeriodState('week', nextAnchor);
  }
  if (state.kind === 'month') {
    const nextAnchor = addMonthsISO(state.anchor, direction);
    return buildPeriodState('month', nextAnchor);
  }
  if (state.kind === 'year') {
    const nextAnchor = addYearsISO(state.anchor, direction);
    return buildPeriodState('year', nextAnchor);
  }
  if (state.kind === 'custom' && state.from && state.to) {
    const dFrom = dateFromLocalISO(state.from);
    const dTo = dateFromLocalISO(state.to);
    const spanDays = Math.max(1, Math.round((dTo.getTime() - dFrom.getTime()) / 86400000) + 1);
    const nextFrom = addDaysISO(state.from, direction * spanDays);
    const nextTo = addDaysISO(state.to, direction * spanDays);
    return buildPeriodState('custom', nextFrom, { from: nextFrom, to: nextTo });
  }
  return state;
}

/**
 * Formata uma data YYYY-MM-DD para DD/MM/AAAA.
 */
export function formatDateBR(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Formata o rótulo legível do seletor de período (ex.: "novembro de 2026", "23 – 29 nov. 2026").
 */
export function formatPeriodLabel(state: PeriodState, todayISO: string = toLocalISODate()): string {
  if (state.kind === 'all') {
    return 'Todo o histórico';
  }
  if (state.kind === 'day') {
    const { year, month, day } = parseLocalISODate(state.from);
    if (state.from === todayISO) {
      return `Hoje, ${day} de ${MONTH_SHORT_PT[month - 1]} ${year}`;
    }
    if (state.from === addDaysISO(todayISO, -1)) {
      return `Ontem, ${day} de ${MONTH_SHORT_PT[month - 1]} ${year}`;
    }
    return `${day} de ${MONTH_NAMES_PT[month - 1]} de ${year}`;
  }
  if (state.kind === 'week') {
    const a = parseLocalISODate(state.from);
    const b = parseLocalISODate(state.to);
    if (a.year === b.year && a.month === b.month) {
      return `${a.day} – ${b.day} de ${MONTH_SHORT_PT[a.month - 1]} ${a.year}`;
    }
    if (a.year === b.year) {
      return `${a.day} ${MONTH_SHORT_PT[a.month - 1]} – ${b.day} ${MONTH_SHORT_PT[b.month - 1]} ${a.year}`;
    }
    return `${formatDateBR(state.from)} – ${formatDateBR(state.to)}`;
  }
  if (state.kind === 'month') {
    const { year, month } = parseLocalISODate(state.from);
    return `${MONTH_NAMES_PT[month - 1]} de ${year}`;
  }
  if (state.kind === 'year') {
    const { year } = parseLocalISODate(state.from);
    return `Ano de ${year}`;
  }
  // custom
  return `${formatDateBR(state.from)} até ${formatDateBR(state.to)}`;
}

/**
 * Verifica se o estado de período atual corresponde exatamente ao período de hoje
 * (ex.: Dia = hoje, Semana = semana atual, Mês = mês atual, Ano = ano atual).
 */
export function isCurrentPeriod(state: PeriodState, todayISO: string = toLocalISODate()): boolean {
  if (state.kind === 'all') return false;
  if (state.kind === 'custom') {
    const currentMonth = getMonthRange(todayISO);
    return state.from === currentMonth.from && state.to === currentMonth.to;
  }
  const currentForKind = buildPeriodState(state.kind, todayISO);
  return state.from === currentForKind.from && state.to === currentForKind.to;
}

/**
 * Formata o cabeçalho de agrupamento por dia na tela de Lançamentos
 * (ex.: "Hoje · 25 de nov.", "Ontem · 24 de nov.", "seg., 23 de nov. de 2026").
 */
export function formatDayHeading(iso: string, todayISO: string = toLocalISODate()): string {
  const { year, month, day } = parseLocalISODate(iso);
  const todayParts = parseLocalISODate(todayISO);
  const d = dateFromLocalISO(iso);
  const dow = WEEKDAY_SHORT_PT[d.getDay()];
  const monthShort = MONTH_SHORT_PT[month - 1];
  const yearSuffix = year !== todayParts.year ? ` de ${year}` : '';

  if (iso === todayISO) {
    return `Hoje · ${day} de ${monthShort}${yearSuffix}`;
  }
  if (iso === addDaysISO(todayISO, -1)) {
    return `Ontem · ${day} de ${monthShort}${yearSuffix}`;
  }
  return `${dow} ${day} de ${monthShort}${yearSuffix}`;
}
