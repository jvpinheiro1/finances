import { Link, useNavigate } from 'react-router';
import {
  BalanceSummary,
  BankImportItem,
  Expense,
  RecurringRule,
  ReportSummary,
  Settlement,
  User,
} from '../api';
import { getCategoryVisual } from '../utils/categoryVisuals';
import { formatBpsPercent, formatMoneyDisplay } from '../utils/format';
import { formatDateBR, PeriodState } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { DonutChart } from './DonutChart';
import { PeriodSelector } from './PeriodSelector';

export function HomeSection({
  user,
  isCollective,
  period,
  onPeriodChange,
  totalCents,
  expenses,
  reportSummary,
  balances,
  settlements,
  recurringRules,
  bankImports,
  hideValues,
  onSelectExpense,
  onFilterCategoryAndNavigate,
}: {
  user: User;
  isCollective: boolean;
  period: PeriodState;
  onPeriodChange: (next: PeriodState) => void;
  totalCents: number;
  expenses: Expense[];
  reportSummary: ReportSummary | null;
  balances: BalanceSummary | null;
  settlements: Settlement[];
  recurringRules: RecurringRule[];
  bankImports: BankImportItem[];
  hideValues: boolean;
  onOpenNewExpense?: () => void;
  onSelectExpense: (exp: Expense) => void;
  onFilterCategoryAndNavigate: (categoryId: string) => void;
}) {
  const navigate = useNavigate();

  const myBalance = balances?.members.find((m) => m.user_id === user.id);
  const pendingSettlements = settlements.filter((s) => s.status === 'pending');
  const activeRecurring = recurringRules.filter((r) => r.is_active);
  const categoryRows = reportSummary?.by_category ?? [];
  const recentExpenses = expenses.slice(0, 6);

  return (
    <div>
      {/* Barra de Período enxuta no topo */}
      <PeriodSelector period={period} onChange={onPeriodChange} />

      {/* Faixa compacta de atalhos / alertas relevantes */}
      <div className="home-status-strip" role="region" aria-label="Atalhos e saldos">
        <Link to="/saldos" className="status-pill-link">
          <span>Meu saldo na casa:</span>
          <strong
            className={`tabular-nums ${
              myBalance
                ? myBalance.net_cents > 0
                  ? 'text-positive'
                  : myBalance.net_cents < 0
                    ? 'text-negative'
                    : ''
                : ''
            }`}
          >
            {myBalance
              ? formatMoneyDisplay(myBalance.net_cents, hideValues, { showPlusSign: true })
              : formatMoneyDisplay(0, hideValues)}
          </strong>
        </Link>

        {pendingSettlements.length > 0 && (
          <Link to="/saldos" className="status-pill-link">
            <span className="badge badge-warning">{pendingSettlements.length}</span>
            <span>
              {pendingSettlements.length === 1
                ? 'reembolso aguardando confirmação'
                : 'reembolsos aguardando confirmação'}
            </span>
          </Link>
        )}

        {bankImports.length > 0 && (
          <Link to="/android" className="status-pill-link">
            <span className="badge badge-warning">{bankImports.length}</span>
            <span>na fila bancária Android</span>
          </Link>
        )}

        {activeRecurring.length > 0 && (
          <Link to="/recorrentes" className="status-pill-link">
            <span>Recorrentes ativas:</span>
            <strong>{activeRecurring.length}</strong>
          </Link>
        )}
      </div>

      {/* Grid Principal 2 Colunas: Esquerda (Donut + Categorias) | Direita (Últimos Lançamentos) */}
      <section className="home-top-grid" aria-label="Resumo do período">
        {/* Coluna Esquerda: Card unificado Donut + Categorias */}
        <div className="home-chart-card">
          <div className="summary-bar">
            <h2>
              {isCollective ? 'Gastos por categoria · Coletivo' : 'Gastos por categoria · Individual 🔒'}
            </h2>
            {reportSummary && reportSummary.total_refunded_cents > 0 && (
              <span className="badge badge-private">
                Estornos: {formatMoneyDisplay(reportSummary.total_refunded_cents, hideValues)}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DonutChart
              rows={categoryRows}
              totalCents={reportSummary?.total_net_cents ?? totalCents}
              expenseCount={reportSummary?.expense_count ?? expenses.length}
              hideValues={hideValues}
              onSelectCategory={(catId) => onFilterCategoryAndNavigate(catId)}
            />
          </div>

          {categoryRows.length === 0 ? (
            <div className="empty-state" style={{ padding: '1rem 0.5rem' }}>
              <p style={{ margin: 0 }}>Nenhuma despesa registrada neste período.</p>
            </div>
          ) : (
            <ul className="category-breakdown-list">
              {categoryRows.map((row) => {
                const visual = getCategoryVisual(row.category_name, row.category_id);
                const pctWidth = Math.min(100, Math.max(2, Math.round(row.share_bps / 100)));
                return (
                  <li key={row.category_id}>
                    <button
                      type="button"
                      className="category-row-btn"
                      onClick={() => onFilterCategoryAndNavigate(row.category_id)}
                    >
                      <div className="category-row-left">
                        <CategoryIconBadge
                          name={row.category_name}
                          categoryId={row.category_id}
                        />
                        <div className="category-row-info">
                          <div className="category-row-title">
                            <span>{row.category_name}</span>
                            <span className="category-row-pct">
                              {formatBpsPercent(row.share_bps)}
                            </span>
                          </div>
                          <div className="category-progress-track" aria-hidden="true">
                            <div
                              className="category-progress-fill"
                              style={{
                                width: `${pctWidth}%`,
                                backgroundColor: visual.colorVar,
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="category-row-right">
                        <span className="category-row-amount">
                          {formatMoneyDisplay(row.total_net_cents, hideValues)}
                        </span>
                        <span className="category-row-pct">
                          {row.expense_count} {row.expense_count === 1 ? 'item' : 'itens'} ›
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Coluna Direita: Últimos lançamentos no período */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="summary-bar" style={{ marginBottom: '0.85rem' }}>
            <h2 id="home-recent-title">Últimos lançamentos no período</h2>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => navigate('/lancamentos')}
            >
              Ver todos ({expenses.length}) ›
            </button>
          </div>

          {recentExpenses.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0.5rem' }}>
              <p style={{ margin: 0 }}>Nenhum lançamento no período selecionado.</p>
            </div>
          ) : (
            <ul className="transaction-list">
              {recentExpenses.map((exp) => (
                <li key={exp.id}>
                  <button
                    type="button"
                    className="transaction-row"
                    onClick={() => onSelectExpense(exp)}
                  >
                    <div className="transaction-row-left">
                      <CategoryIconBadge name={exp.category_name} categoryId={exp.category_id} />
                      <div className="transaction-row-main">
                        <div className="transaction-row-title">
                          <span>{exp.description}</span>
                          {exp.installment_number && exp.total_installments && (
                            <span className="badge">
                              {exp.installment_number}/{exp.total_installments}
                            </span>
                          )}
                          {exp.recurring_period && (
                            <span className="badge badge-neutral">Recorrente</span>
                          )}
                          {exp.refunded_cents > 0 && (
                            <span className="badge badge-private">Estorno</span>
                          )}
                        </div>
                        <div className="transaction-row-meta">
                          <span>{formatDateBR(exp.incurred_on)}</span>
                          <span>· {exp.category_name}</span>
                          <span>· {exp.paid_by_name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="transaction-row-right">
                      <span className="transaction-amount">
                        {formatMoneyDisplay(exp.net_amount_cents, hideValues)}
                      </span>
                      {exp.refunded_cents > 0 && (
                        <span className="transaction-amount-original">
                          {formatMoneyDisplay(exp.amount_cents, hideValues)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
