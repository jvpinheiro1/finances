import { useMemo, useState } from 'react';
import { Category, Expense } from '../api';
import { formatMoneyDisplay } from '../utils/format';
import { formatDayHeading, PeriodState } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { PeriodSelector } from './PeriodSelector';
import { SelectField } from './ui/SelectField';

type SortOrder = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export function ExpensesSection({
  isCollective,
  categories,
  expenses,
  totalCents,
  period,
  onPeriodChange,
  filterCatId,
  onFilterCatChange,
  hideValues,
  onSelectExpense,
}: {
  isCollective: boolean;
  categories: Category[];
  expenses: Expense[];
  totalCents: number;
  period: PeriodState;
  onPeriodChange: (next: PeriodState) => void;
  filterCatId: string;
  onFilterCatChange: (catId: string) => void;
  hideValues: boolean;
  onOpenNewExpense?: () => void;
  onSelectExpense: (exp: Expense) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('date_desc');

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? expenses.filter(
          (e) =>
            e.description.toLowerCase().includes(q) ||
            e.category_name.toLowerCase().includes(q) ||
            e.paid_by_name.toLowerCase().includes(q) ||
            (e.notes && e.notes.toLowerCase().includes(q)) ||
            (e.payment_method_name && e.payment_method_name.toLowerCase().includes(q)),
        )
      : [...expenses];

    list.sort((a, b) => {
      if (sortOrder === 'date_desc') {
        return b.incurred_on.localeCompare(a.incurred_on) || b.created_at.localeCompare(a.created_at);
      }
      if (sortOrder === 'date_asc') {
        return a.incurred_on.localeCompare(b.incurred_on) || a.created_at.localeCompare(b.created_at);
      }
      if (sortOrder === 'amount_desc') {
        return b.net_amount_cents - a.net_amount_cents;
      }
      return a.net_amount_cents - b.net_amount_cents;
    });

    return list;
  }, [expenses, searchQuery, sortOrder]);

  const filteredTotalCents = useMemo(
    () => filteredAndSorted.reduce((acc, e) => acc + e.net_amount_cents, 0),
    [filteredAndSorted],
  );

  // Agrupa lançamentos por dia (incurred_on)
  const dayGroups = useMemo(() => {
    const groups: { date: string; items: Expense[]; subtotalCents: number }[] = [];
    const map = new Map<string, { date: string; items: Expense[]; subtotalCents: number }>();

    for (const exp of filteredAndSorted) {
      let grp = map.get(exp.incurred_on);
      if (!grp) {
        grp = { date: exp.incurred_on, items: [], subtotalCents: 0 };
        map.set(exp.incurred_on, grp);
        groups.push(grp);
      }
      grp.items.push(exp);
      grp.subtotalCents += exp.net_amount_cents;
    }
    return groups;
  }, [filteredAndSorted]);

  const activeCategory = categories.find((c) => c.id === filterCatId);

  return (
    <div>
      {/* Barra de Período */}
      <PeriodSelector period={period} onChange={onPeriodChange} />

      {/* Painel de Resumo + Busca + Ordenação + Filtro por Categoria */}
      <section className="panel" aria-labelledby="list-exp-title">
        <div className="summary-bar">
          <div>
            <h2 id="list-exp-title">
              {isCollective ? 'Coletivo' : 'Individual 🔒'} · {filteredAndSorted.length}{' '}
              {filteredAndSorted.length === 1 ? 'lançamento' : 'lançamentos'}
            </h2>
          </div>
          <div className="total-amount" aria-live="polite">
            {formatMoneyDisplay(
              searchQuery.trim() ? filteredTotalCents : totalCents,
              hideValues,
            )}
          </div>
        </div>

        <div className="form-grid form-grid-3" style={{ marginTop: '0.85rem' }}>
          <div className="field">
            <label htmlFor="exp-search">Buscar</label>
            <input
              id="exp-search"
              type="search"
              placeholder="Descrição, categoria, quem pagou…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="filter-cat">Categoria</label>
            <SelectField
              id="filter-cat"
              value={filterCatId}
              onChange={(e) => onFilterCatChange(e.target.value)}
            >
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="field">
            <label htmlFor="exp-sort">Ordenar por</label>
            <SelectField
              id="exp-sort"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            >
              <option value="date_desc">Mais recentes primeiro</option>
              <option value="date_asc">Mais antigos primeiro</option>
              <option value="amount_desc">Maior valor líquido</option>
              <option value="amount_asc">Menor valor líquido</option>
            </SelectField>
          </div>
        </div>

        {activeCategory && (
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge">Categoria: {activeCategory.name}</span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => onFilterCatChange('')}
            >
              Limpar filtro ✕
            </button>
          </div>
        )}
      </section>

      {/* Lista Agrupada por Dia */}
      {dayGroups.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <p style={{ margin: 0 }}>
              Nenhuma despesa encontrada para os filtros e período selecionados.
            </p>
          </div>
        </section>
      ) : (
        dayGroups.map((group) => (
          <section
            key={group.date}
            className="day-group"
            aria-label={`Lançamentos de ${group.date}`}
          >
            <div className="day-group-header">
              <span>{formatDayHeading(group.date)}</span>
              <span className="day-group-subtotal">
                {formatMoneyDisplay(group.subtotalCents, hideValues)}
              </span>
            </div>

            <ul className="transaction-list">
              {group.items.map((exp) => (
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
                          <span className="badge badge-neutral">{exp.category_name}</span>
                          {exp.installment_number && exp.total_installments && (
                            <span className="badge">
                              {exp.installment_number}/{exp.total_installments}
                            </span>
                          )}
                          {exp.recurring_period && (
                            <span className="badge badge-neutral">
                              Recorrente {exp.recurring_period}
                            </span>
                          )}
                          {exp.refunded_cents > 0 && (
                            <span className="badge badge-private">
                              Estornado {formatMoneyDisplay(exp.refunded_cents, hideValues)}
                            </span>
                          )}
                          {exp.shared_at && (
                            <span className="badge">Compartilhada</span>
                          )}
                        </div>

                        <div className="transaction-row-meta">
                          <span>Pago por {exp.paid_by_name}</span>
                          {exp.payment_method_name && (
                            <span>
                              · {exp.payment_method_name}
                              {exp.payment_method_last4
                                ? ` (•••• ${exp.payment_method_last4})`
                                : ''}
                            </span>
                          )}
                          {exp.notes && <span>· {exp.notes}</span>}
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
          </section>
        ))
      )}
    </div>
  );
}
