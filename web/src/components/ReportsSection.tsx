import { api, ReportSummary } from '../api';
import { formatBpsPercent, formatMoneyDisplay } from '../utils/format';
import { PeriodState } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { PeriodSelector } from './PeriodSelector';

interface ReportsSectionProps {
  activeWsId: string;
  isCollective: boolean;
  reportSummary: ReportSummary | null;
  period: PeriodState;
  onPeriodChange: (next: PeriodState) => void;
  hideValues?: boolean;
}

export function ReportsSection({
  activeWsId,
  isCollective,
  reportSummary,
  period,
  onPeriodChange,
  hideValues = false,
}: ReportsSectionProps) {
  return (
    <div>
      <PeriodSelector period={period} onChange={onPeriodChange} />

      <section className="panel" aria-labelledby="reports-title">
        <div className="summary-bar">
          <div>
            <h2 id="reports-title">
              {isCollective ? 'Coletivo' : 'Individual 🔒'}
            </h2>
            {reportSummary && (
              <p className="subtitle">
                {reportSummary.from_date} a {reportSummary.to_date} ·{' '}
                {reportSummary.expense_count} lançamentos · Líquido:{' '}
                <strong className="tabular-nums">
                  {formatMoneyDisplay(reportSummary.total_net_cents, hideValues)}
                </strong>
                {reportSummary.total_refunded_cents > 0 && (
                  <>
                    {' '}
                    · Estornado:{' '}
                    <span className="tabular-nums text-positive">
                      {formatMoneyDisplay(reportSummary.total_refunded_cents, hideValues)}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="user-bar">
            <a
              className="btn btn-outline btn-sm"
              href={api.reportExportUrl(
                activeWsId,
                'csv',
                period.from || undefined,
                period.to || undefined,
              )}
              download
            >
              Baixar CSV (Excel)
            </a>
            <a
              className="btn btn-primary btn-sm"
              href={api.reportExportUrl(
                activeWsId,
                'pdf',
                period.from || undefined,
                period.to || undefined,
              )}
              download
            >
              Baixar PDF
            </a>
          </div>
        </div>

        {!reportSummary ? (
          <p className="subtitle" style={{ marginTop: '1rem' }}>
            Carregando consolidação do período…
          </p>
        ) : (
          <>
            <div className="form-grid form-grid-2" style={{ marginTop: '1.25rem' }}>
              <div>
                <h3>Por Categoria</h3>
                {reportSummary.by_category.length === 0 ? (
                  <p className="subtitle">Sem dados no período.</p>
                ) : (
                  <ul className="expense-list">
                    {reportSummary.by_category.map((c) => (
                      <li
                        key={c.category_id}
                        className="expense-item"
                        style={{ padding: '0.65rem 0.9rem' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <CategoryIconBadge name={c.category_name} categoryId={c.category_id} />
                          <div>
                            <strong>{c.category_name}</strong> ({c.expense_count})
                          </div>
                        </div>
                        <div className="expense-right">
                          <span className="badge badge-neutral tabular-nums">
                            {formatBpsPercent(c.share_bps)}
                          </span>
                          <strong className="tabular-nums">
                            {formatMoneyDisplay(c.total_net_cents, hideValues)}
                          </strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3>Por Meio de Pagamento</h3>
                {reportSummary.by_payment_method.length === 0 ? (
                  <p className="subtitle">Sem dados no período.</p>
                ) : (
                  <ul className="expense-list">
                    {reportSummary.by_payment_method.map((pm) => (
                      <li
                        key={pm.label}
                        className="expense-item"
                        style={{ padding: '0.65rem 0.9rem' }}
                      >
                        <div>
                          <strong>{pm.label}</strong> ({pm.expense_count})
                        </div>
                        <div className="expense-right">
                          <span className="badge badge-neutral tabular-nums">
                            {formatBpsPercent(pm.share_bps)}
                          </span>
                          <strong className="tabular-nums">
                            {formatMoneyDisplay(pm.total_net_cents, hideValues)}
                          </strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {isCollective && reportSummary.by_member.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3>Desembolsado vs Consumido na Divisão por Familiar</h3>
                <ul className="expense-list">
                  {reportSummary.by_member.map((m) => (
                    <li
                      key={m.user_id}
                      className="expense-item"
                      style={{ padding: '0.65rem 0.9rem' }}
                    >
                      <div>
                        <strong>{m.user_name}</strong>
                      </div>
                      <div className="expense-meta" style={{ fontSize: '0.9rem' }}>
                        <span className="tabular-nums">
                          Pagou: {formatMoneyDisplay(m.paid_net_cents, hideValues)}
                        </span>
                        <span className="tabular-nums">
                          · Consumiu: {formatMoneyDisplay(m.consumed_net_cents, hideValues)}
                        </span>
                        <span className="tabular-nums">
                          · Diferença do período:{' '}
                          <strong
                            className={
                              m.delta_cents > 0
                                ? 'text-positive'
                                : m.delta_cents < 0
                                  ? 'text-negative'
                                  : ''
                            }
                          >
                            {formatMoneyDisplay(m.delta_cents, hideValues, { showPlusSign: true })}
                          </strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
