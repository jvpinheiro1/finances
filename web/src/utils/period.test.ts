import { describe, expect, it } from 'vitest';
import {
  addMonthsISO,
  buildPeriodState,
  formatDayHeading,
  formatPeriodLabel,
  getISOWeekRange,
  getMonthRange,
  isCurrentPeriod,
  shiftPeriod,
  toLocalISODate,
} from './period';

describe('period e datas locais (DA-6 = A, DA-8 = A)', () => {
  it('converte Date local para YYYY-MM-DD sem deslocar o dia à noite', () => {
    const lateNightLocal = new Date(2026, 10, 25, 23, 45, 0); // 25/11/2026 23:45 local
    expect(toLocalISODate(lateNightLocal)).toBe('2026-11-25');
  });

  it('calcula o mês corrente corretamente (incluindo ano bissexto)', () => {
    expect(getMonthRange('2026-11-25')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(getMonthRange('2024-02-10')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(getMonthRange('2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('calcula a semana ISO-8601 iniciando na segunda-feira e terminando no domingo (DA-8 = A)', () => {
    // 2026-11-25 é uma quarta-feira -> segunda 23/11 a domingo 29/11
    expect(getISOWeekRange('2026-11-25')).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
    // Domingo 2026-11-29 pertence à mesma semana iniciada na segunda 2026-11-23
    expect(getISOWeekRange('2026-11-29')).toEqual({
      from: '2026-11-23',
      to: '2026-11-29',
    });
  });

  it('avança e recua períodos de Dia, Semana, Mês e Ano com shiftPeriod', () => {
    const monthState = buildPeriodState('month', '2026-11-25');
    expect(monthState.from).toBe('2026-11-01');
    expect(monthState.to).toBe('2026-11-30');

    const prevMonth = shiftPeriod(monthState, -1);
    expect(prevMonth.from).toBe('2026-10-01');
    expect(prevMonth.to).toBe('2026-10-31');

    const nextMonth = shiftPeriod(monthState, 1);
    expect(nextMonth.from).toBe('2026-12-01');
    expect(nextMonth.to).toBe('2026-12-31');

    const weekState = buildPeriodState('week', '2026-11-25');
    const nextWeek = shiftPeriod(weekState, 1);
    expect(nextWeek.from).toBe('2026-11-30');
    expect(nextWeek.to).toBe('2026-12-06');
  });

  it('ajusta o último dia ao somar meses a partir do dia 31', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('formata rótulos de período e cabeçalhos de dia em pt-BR', () => {
    const m = buildPeriodState('month', '2026-11-25');
    expect(formatPeriodLabel(m, '2026-11-25')).toBe('novembro de 2026');

    expect(formatDayHeading('2026-11-25', '2026-11-25')).toContain('Hoje');
    expect(formatDayHeading('2026-11-24', '2026-11-25')).toContain('Ontem');
  });

  it('identifica se o estado de período atual corresponde a hoje ou ao mês atual (isCurrentPeriod)', () => {
    const today = '2026-11-25';
    expect(isCurrentPeriod(buildPeriodState('day', today), today)).toBe(true);
    expect(isCurrentPeriod(buildPeriodState('day', '2026-11-24'), today)).toBe(false);
    expect(isCurrentPeriod(buildPeriodState('month', '2026-11-05'), today)).toBe(true);
    expect(isCurrentPeriod(buildPeriodState('month', '2026-10-25'), today)).toBe(false);
  });
});
