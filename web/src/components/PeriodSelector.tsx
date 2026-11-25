import {
  buildPeriodState,
  formatPeriodLabel,
  getMonthRange,
  isCurrentPeriod,
  PeriodKind,
  PeriodState,
  shiftPeriod,
  toLocalISODate,
} from '../utils/period';
import { DateInput } from './ui/DateInput';

const PERIOD_TABS: { kind: PeriodKind; label: string }[] = [
  { kind: 'day', label: 'Dia' },
  { kind: 'week', label: 'Semana' },
  { kind: 'month', label: 'Mês' },
  { kind: 'year', label: 'Ano' },
  { kind: 'custom', label: 'Período' },
  { kind: 'all', label: 'Tudo' },
];

export function PeriodSelector({
  period,
  onChange,
}: {
  period: PeriodState;
  onChange: (next: PeriodState) => void;
}) {
  const todayISO = toLocalISODate();
  const todayMonth = getMonthRange(todayISO);
  const isTodayDay = period.kind === 'day' && period.from === todayISO && period.to === todayISO;
  const isThisMonth =
    period.kind === 'month' && period.from === todayMonth.from && period.to === todayMonth.to;
  const isAtCurrentAnchor = isCurrentPeriod(period, todayISO);

  function handleSelectKind(kind: PeriodKind) {
    if (kind === 'custom') {
      onChange(
        buildPeriodState('custom', period.anchor, {
          from: period.from,
          to: period.to,
        }),
      );
      return;
    }
    onChange(buildPeriodState(kind, period.anchor));
  }

  return (
    <div className="period-bar" role="region" aria-label="Filtro de período">
      <div className="period-top-row">
        <div className="period-tabs" role="tablist" aria-label="Granularidade do período">
          {PERIOD_TABS.map((t) => {
            const active = period.kind === t.kind;
            return (
              <button
                key={t.kind}
                type="button"
                role="tab"
                aria-selected={active}
                className="period-tab"
                onClick={() => handleSelectKind(t.kind)}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="period-quick-shortcuts" role="group" aria-label="Atalhos de período atual">
          <button
            type="button"
            className="period-shortcut-btn"
            aria-pressed={isTodayDay}
            title="Ir para o dia de hoje"
            onClick={() => onChange(buildPeriodState('day', todayISO))}
          >
            Hoje
          </button>
          <button
            type="button"
            className="period-shortcut-btn"
            aria-pressed={isThisMonth}
            title="Voltar para o mês atual"
            onClick={() => onChange(buildPeriodState('month', todayISO))}
          >
            Mês atual
          </button>
          {!isAtCurrentAnchor &&
            period.kind !== 'day' &&
            period.kind !== 'month' &&
            period.kind !== 'all' && (
              <button
                type="button"
                className="period-shortcut-btn"
                title="Voltar ao período atual"
                onClick={() => onChange(buildPeriodState(period.kind, todayISO))}
              >
                {period.kind === 'week' ? 'Semana atual' : 'Ano atual'}
              </button>
            )}
        </div>
      </div>

      <div className="period-nav-row">
        <button
          type="button"
          className="icon-btn"
          aria-label="Período anterior"
          disabled={period.kind === 'all'}
          onClick={() => onChange(shiftPeriod(period, -1))}
        >
          ‹
        </button>

        <div className="period-nav-label" aria-live="polite">
          {formatPeriodLabel(period)}
        </div>

        <button
          type="button"
          className="icon-btn"
          aria-label="Período seguinte"
          disabled={period.kind === 'all'}
          onClick={() => onChange(shiftPeriod(period, 1))}
        >
          ›
        </button>
      </div>

      {period.kind === 'custom' && (
        <div className="period-custom-inputs">
          <label htmlFor="period-custom-from" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            De:
          </label>
          <div style={{ width: '11rem' }}>
            <DateInput
              id="period-custom-from"
              value={period.from}
              onChange={(val) =>
                onChange(
                  buildPeriodState('custom', val, {
                    from: val,
                    to: period.to,
                  }),
                )
              }
            />
          </div>
          <label htmlFor="period-custom-to" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Até:
          </label>
          <div style={{ width: '11rem' }}>
            <DateInput
              id="period-custom-to"
              value={period.to}
              onChange={(val) =>
                onChange(
                  buildPeriodState('custom', period.from, {
                    from: period.from,
                    to: val,
                  }),
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
