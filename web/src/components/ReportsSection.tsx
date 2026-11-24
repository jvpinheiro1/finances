import { api, formatCentsBRL, ReportSummary } from '../api';

interface ReportsSectionProps {
  activeWsId: string;
  isCollective: boolean;
  reportSummary: ReportSummary | null;
  filterFrom: string;
  filterTo: string;
  onFilterFromChange: (v: string) => void;
  onFilterToChange: (v: string) => void;
}

export function ReportsSection({
  activeWsId,
  isCollective,
  reportSummary,
  filterFrom,
  filterTo,
  onFilterFromChange,
  onFilterToChange,
}: ReportsSectionProps) {
  return (
    <section className="panel" aria-labelledby="reports-title">
      <div className="summary-bar">
        <div>
          <h2 id="reports-title">
            Relatório Financeiro — {isCollective ? 'Espaço da Família' : 'Meu Espaço Individual'}
          </h2>
          {reportSummary && (
            <p className="subtitle">
              Período: {reportSummary.from_date} a {reportSummary.to_date} ·{' '}
              {reportSummary.expense_count} lançamentos · Bruto:{' '}
              {formatCentsBRL(reportSummary.total_gross_cents)} · Estornado:{' '}
              {formatCentsBRL(reportSummary.total_refunded_cents)} · Líquido:{' '}
              <strong>{formatCentsBRL(reportSummary.total_net_cents)}</strong>
            </p>
          )}
        </div>
        <div className="user-bar">
          <a
            className="btn btn-outline btn-sm"
            href={api.reportExportUrl(
              activeWsId,
              'csv',
              filterFrom || undefined,
              filterTo || undefined,
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
              filterFrom || undefined,
              filterTo || undefined,
            )}
            download
          >
            Baixar PDF
          </a>
        </div>
      </div>

      <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
        <div className="field">
          <label htmlFor="rep-from">Período inicial (opcional)</label>
          <input
            id="rep-from"
            type="date"
            value={filterFrom}
            onChange={(e) => onFilterFromChange(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="rep-to">Período final (opcional)</label>
          <input
            id="rep-to"
            type="date"
            value={filterTo}
            onChange={(e) => onFilterToChange(e.target.value)}
          />
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
                      <div>
                        <strong>{c.category_name}</strong> ({c.expense_count})
                      </div>
                      <div className="expense-right">
                        <span className="badge badge-neutral">
                          {(c.share_bps / 100).toFixed(1).replace('.', ',')}%
                        </span>
                        <strong>{formatCentsBRL(c.total_net_cents)}</strong>
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
                        <span className="badge badge-neutral">
                          {(pm.share_bps / 100).toFixed(1).replace('.', ',')}%
                        </span>
                        <strong>{formatCentsBRL(pm.total_net_cents)}</strong>
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
                  <li key={m.user_id} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                    <div>
                      <strong>{m.user_name}</strong>
                    </div>
                    <div className="expense-meta" style={{ fontSize: '0.9rem' }}>
                      <span>Pagou: {formatCentsBRL(m.paid_net_cents)}</span>
                      <span>· Consumiu: {formatCentsBRL(m.consumed_net_cents)}</span>
                      <span>
                        · Diferença do período: <strong>{formatCentsBRL(m.delta_cents)}</strong>
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
  );
}
