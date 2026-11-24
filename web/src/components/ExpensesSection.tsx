import React, { useState } from 'react';
import {
  api,
  ApiError,
  Category,
  centsToInput,
  Expense,
  formatCentsBRL,
  Household,
  parseBRLToCents,
  parsePercentToBps,
  PaymentKind,
  PaymentMethod,
  SplitInput,
  SplitStrategy,
  User,
} from '../api';

const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};

const SPLIT_STRATEGY_LABELS: Record<SplitStrategy, string> = {
  equal: 'Partes iguais entre os participantes marcados',
  exact: 'Valor exato em R$ por participante',
  percentage: 'Porcentagem (%) por participante',
  shares: 'Cotas / Pesos (ex.: 2 e 1)',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ExpensesSectionProps {
  user: User;
  household: Household | null;
  activeWsId: string;
  isCollective: boolean;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  expenses: Expense[];
  totalCents: number;
  filterFrom: string;
  filterTo: string;
  filterCatId: string;
  onFilterFromChange: (v: string) => void;
  onFilterToChange: (v: string) => void;
  onFilterCatChange: (v: string) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function ExpensesSection({
  user,
  household,
  activeWsId,
  isCollective,
  categories,
  paymentMethods,
  expenses,
  totalCents,
  filterFrom,
  filterTo,
  filterCatId,
  onFilterFromChange,
  onFilterToChange,
  onFilterCatChange,
  onRefresh,
  onError,
}: ExpensesSectionProps) {
  const [showForm, setShowForm] = useState<boolean>(true);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayISO());
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paidByUserId, setPaidByUserId] = useState(user.id);
  const [totalInstallments, setTotalInstallments] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const m of household?.members ?? []) {
      map[m.id] = true;
    }
    return map;
  });
  const [splitCustomValues, setSplitCustomValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Estorno inline
  const [refundingExpense, setRefundingExpense] = useState<Expense | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundDate, setRefundDate] = useState(todayISO());
  const [refundReason, setRefundReason] = useState('');

  const effectiveCatId = categoryId || categories[0]?.id || '';

  function resetParticipants() {
    const map: Record<string, boolean> = {};
    for (const m of household?.members ?? []) {
      map[m.id] = true;
    }
    setSelectedParticipants(map);
    setSplitCustomValues({});
  }

  function resetExpenseForm() {
    setEditingExpense(null);
    setDescription('');
    setAmountInput('');
    setIncurredOn(todayISO());
    setCategoryId(categories[0]?.id ?? '');
    setPaymentMethodId('');
    setPaidByUserId(user.id);
    setTotalInstallments(1);
    setNotes('');
    setSplitStrategy('equal');
    resetParticipants();
  }

  function startEditExpense(exp: Expense) {
    setShowForm(true);
    setEditingExpense(exp);
    setDescription(exp.description);
    setAmountInput(centsToInput(exp.amount_cents));
    setIncurredOn(exp.incurred_on);
    setCategoryId(exp.category_id);
    setPaymentMethodId(exp.payment_method_id ?? '');
    setPaidByUserId(exp.paid_by_user_id);
    setTotalInstallments(1);
    setNotes(exp.notes);
    setSplitStrategy(exp.split_strategy || 'equal');

    if (household && exp.splits && exp.splits.length > 0) {
      const partMap: Record<string, boolean> = {};
      const valMap: Record<string, string> = {};
      for (const m of household.members) {
        partMap[m.id] = false;
      }
      for (const sp of exp.splits) {
        partMap[sp.user_id] = true;
        if (exp.split_strategy === 'exact') {
          valMap[sp.user_id] = centsToInput(sp.share_cents);
        } else if (exp.split_strategy === 'percentage' && sp.weight_bps) {
          valMap[sp.user_id] = (sp.weight_bps / 100).toFixed(2).replace('.', ',');
        } else if (exp.split_strategy === 'shares' && sp.weight_bps) {
          valMap[sp.user_id] = String(sp.weight_bps);
        }
      }
      setSelectedParticipants(partMap);
      setSplitCustomValues(valMap);
    } else {
      resetParticipants();
    }
  }

  function buildSplitsInput(): SplitInput[] | null {
    if (!isCollective || !household) return [];
    const activeIds = household.members
      .filter((m) => selectedParticipants[m.id] !== false)
      .map((m) => m.id);
    if (activeIds.length === 0) {
      onError('Selecione pelo menos 1 familiar participante na divisão.');
      return null;
    }
    if (splitStrategy === 'equal') {
      return activeIds.map((id) => ({ user_id: id }));
    }

    const out: SplitInput[] = [];
    for (const id of activeIds) {
      const raw = splitCustomValues[id] ?? '';
      if (splitStrategy === 'exact') {
        const cents = parseBRLToCents(raw);
        if (cents === null) {
          onError('Informe um valor válido em R$ para cada participante selecionado.');
          return null;
        }
        out.push({ user_id: id, share_cents: cents });
      } else if (splitStrategy === 'percentage') {
        const bps = parsePercentToBps(raw);
        if (bps === null) {
          onError('Informe uma porcentagem válida para cada participante (soma deve ser 100%).');
          return null;
        }
        out.push({ user_id: id, weight_bps: bps });
      } else if (splitStrategy === 'shares') {
        const w = parseInt(raw.trim(), 10);
        if (!Number.isInteger(w) || w <= 0) {
          onError('Informe um número inteiro positivo de cotas para cada participante.');
          return null;
        }
        out.push({ user_id: id, weight_bps: w });
      }
    }
    return out;
  }

  async function handleSaveExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWsId) return;
    onError(null);
    const cents = parseBRLToCents(amountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais (ex.: 45,90).');
      return;
    }
    const splits = buildSplitsInput();
    if (splits === null) return;

    setSubmitting(true);
    try {
      const payload = {
        category_id: effectiveCatId,
        payment_method_id: paymentMethodId ? paymentMethodId : null,
        paid_by_user_id: isCollective ? paidByUserId : user.id,
        amount_cents: cents,
        description,
        incurred_on: incurredOn,
        notes,
        split_strategy: isCollective ? splitStrategy : ('equal' as SplitStrategy),
        splits: isCollective ? splits : undefined,
        total_installments: editingExpense ? 1 : totalInstallments,
      };
      if (editingExpense) {
        await api.updateExpense(editingExpense.id, payload);
      } else {
        await api.createExpense(activeWsId, payload);
      }
      resetExpenseForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao salvar despesa');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteExpense(exp: Expense) {
    onError(null);
    try {
      await api.deleteExpense(exp.id);
      if (editingExpense?.id === exp.id) {
        resetExpenseForm();
      }
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao excluir despesa');
    }
  }

  async function handleDeleteInstallmentPlan(planId: string) {
    onError(null);
    try {
      await api.deleteInstallmentPlan(planId);
      resetExpenseForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao excluir parcelamento completo');
    }
  }

  function startRefund(exp: Expense) {
    setRefundingExpense(exp);
    setRefundAmountInput(centsToInput(exp.net_amount_cents));
    setRefundDate(todayISO());
    setRefundReason('');
  }

  async function handleCreateRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundingExpense) return;
    onError(null);
    const cents = parseBRLToCents(refundAmountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais para o estorno.');
      return;
    }
    try {
      await api.createRefund(refundingExpense.id, {
        amount_cents: cents,
        refunded_on: refundDate,
        reason: refundReason,
      });
      setRefundingExpense(null);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao registrar estorno');
    }
  }

  async function handleShareExpense(exp: Expense) {
    onError(null);
    try {
      await api.shareExpenseWithHousehold(exp.id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao compartilhar despesa com a casa');
    }
  }

  return (
    <div>
      <section className="panel" aria-labelledby="form-exp-title">
        <div className="summary-bar">
          <div>
            <h2 id="form-exp-title">
              {editingExpense
                ? 'Editar despesa / parcela'
                : isCollective
                  ? 'Nova Despesa no Espaço da Família (Coletivo)'
                  : 'Nova Despesa no Meu Espaço Individual (Privado)'}
            </h2>
            <p className="subtitle">
              {isCollective
                ? 'Qualquer lançamento coletivo entra automaticamente no rateio entre os participantes marcados.'
                : 'Seus gastos individuais são protegidos por RLS e nunca aparecem para os outros familiares.'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Recolher formulário' : '+ Abrir formulário'}
          </button>
        </div>

        {showForm && (
          <form className="form-stack" onSubmit={handleSaveExpense}>
            <div className="form-grid form-grid-3">
              <div className="field">
                <label htmlFor="exp-desc">Descrição</label>
                <input
                  id="exp-desc"
                  type="text"
                  required
                  maxLength={160}
                  placeholder="Ex.: Supermercado, Geladeira"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="exp-amount">
                  {totalInstallments > 1 ? 'Valor total da compra (R$)' : 'Valor (R$)'}
                </label>
                <input
                  id="exp-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0,00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="exp-date">Data da compra</label>
                <input
                  id="exp-date"
                  type="date"
                  required
                  value={incurredOn}
                  onChange={(e) => setIncurredOn(e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid form-grid-3">
              <div className="field">
                <label htmlFor="exp-cat">Categoria</label>
                <select
                  id="exp-cat"
                  required
                  value={effectiveCatId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="exp-pm">Meio de pagamento (opcional)</label>
                <select
                  id="exp-pm"
                  value={paymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                >
                  <option value="">Não informado</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} ({PAYMENT_KIND_LABELS[pm.kind]}
                      {pm.last4 ? ` •••• ${pm.last4}` : ''})
                    </option>
                  ))}
                </select>
              </div>

              {!editingExpense && (
                <div className="field">
                  <label htmlFor="exp-installments">Parcelas (1x a 48x)</label>
                  <input
                    id="exp-installments"
                    type="number"
                    min={1}
                    max={48}
                    required
                    value={totalInstallments}
                    onChange={(e) =>
                      setTotalInstallments(Math.max(1, Math.min(48, Number(e.target.value) || 1)))
                    }
                  />
                  {totalInstallments > 1 && (
                    <p className="field-hint">
                      Gera {totalInstallments} parcelas mensais (resto de centavos na 1ª parcela).
                    </p>
                  )}
                </div>
              )}

              {isCollective && household && (
                <div className="field">
                  <label htmlFor="exp-paidby">Pago por</label>
                  <select
                    id="exp-paidby"
                    value={paidByUserId}
                    onChange={(e) => setPaidByUserId(e.target.value)}
                  >
                    {household.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.id === user.id ? '(você)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {isCollective && household && (
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="field">
                  <label htmlFor="exp-split-strategy">Divisão entre familiares</label>
                  <select
                    id="exp-split-strategy"
                    value={splitStrategy}
                    onChange={(e) => setSplitStrategy(e.target.value as SplitStrategy)}
                  >
                    {(Object.keys(SPLIT_STRATEGY_LABELS) as SplitStrategy[]).map((s) => (
                      <option key={s} value={s}>
                        {SPLIT_STRATEGY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">
                    Eventuais centavos de resto são absorvidos deterministicamente por quem pagou a
                    despesa (ADR 0006).
                  </p>
                </div>

                <div className="form-grid form-grid-2" style={{ marginTop: '0.75rem' }}>
                  {household.members.map((m) => {
                    const checked = selectedParticipants[m.id] !== false;
                    return (
                      <div key={m.id} className="expense-item" style={{ padding: '0.65rem 0.85rem' }}>
                        <label className="field-checkbox" style={{ minHeight: '2rem' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedParticipants((prev) => ({
                                ...prev,
                                [m.id]: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            {m.name} {m.id === user.id ? '(você)' : ''}
                          </span>
                        </label>

                        {checked && splitStrategy !== 'equal' && (
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Valor ou peso de ${m.name}`}
                            placeholder={
                              splitStrategy === 'exact'
                                ? 'R$ 0,00'
                                : splitStrategy === 'percentage'
                                  ? 'Ex.: 50%'
                                  : 'Cotas (ex.: 1)'
                            }
                            style={{ width: '7.5rem', minHeight: '2.25rem', padding: '0.35rem 0.6rem' }}
                            value={splitCustomValues[m.id] ?? ''}
                            onChange={(e) =>
                              setSplitCustomValues((prev) => ({
                                ...prev,
                                [m.id]: e.target.value,
                              }))
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="exp-notes">Observações (opcional)</label>
              <input
                id="exp-notes"
                type="text"
                maxLength={500}
                placeholder="Detalhes adicionais (nunca insira número completo de cartão ou senha)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="user-bar">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting
                  ? 'Salvando…'
                  : editingExpense
                    ? 'Salvar alterações'
                    : totalInstallments > 1
                      ? `Registrar compra em ${totalInstallments}x`
                      : 'Registrar despesa'}
              </button>
              {editingExpense && (
                <button type="button" className="btn btn-outline" onClick={resetExpenseForm}>
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {refundingExpense && (
        <section className="panel" aria-labelledby="refund-form-title">
          <h2 id="refund-form-title">
            Registrar estorno em: {refundingExpense.description} (Saldo disponível:{' '}
            {formatCentsBRL(refundingExpense.net_amount_cents)})
          </h2>
          <form className="form-stack" onSubmit={handleCreateRefund}>
            <div className="form-grid form-grid-3">
              <div className="field">
                <label htmlFor="ref-amount">Valor a estornar (R$)</label>
                <input
                  id="ref-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  value={refundAmountInput}
                  onChange={(e) => setRefundAmountInput(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ref-date">Data do estorno</label>
                <input
                  id="ref-date"
                  type="date"
                  required
                  value={refundDate}
                  onChange={(e) => setRefundDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="ref-reason">Motivo (opcional)</label>
                <input
                  id="ref-reason"
                  type="text"
                  maxLength={300}
                  placeholder="Ex.: Devolução parcial, cobrança duplicada"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
            </div>
            <div className="user-bar">
              <button type="submit" className="btn btn-primary">
                Confirmar estorno
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setRefundingExpense(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel" aria-labelledby="list-exp-title">
        <div className="summary-bar">
          <div>
            <h2 id="list-exp-title">
              {isCollective ? 'Extrato de Despesas da Família' : 'Extrato de Despesas Individuais'}{' '}
              ({expenses.length})
            </h2>
            <p className="subtitle">Soma líquida em centavos (descontando estornos)</p>
          </div>
          <div className="total-amount" aria-live="polite">
            {formatCentsBRL(totalCents)}
          </div>
        </div>

        <div className="form-grid form-grid-3" style={{ margin: '1rem 0' }}>
          <div className="field">
            <label htmlFor="filter-from">De (data inicial)</label>
            <input
              id="filter-from"
              type="date"
              value={filterFrom}
              onChange={(e) => onFilterFromChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-to">Até (data final)</label>
            <input
              id="filter-to"
              type="date"
              value={filterTo}
              onChange={(e) => onFilterToChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-cat">Filtrar por categoria</label>
            <select
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
            </select>
          </div>
        </div>

        {expenses.length === 0 ? (
          <p className="subtitle">Nenhuma despesa registrada neste ambiente/período.</p>
        ) : (
          <ul className="expense-list">
            {expenses.map((exp) => (
              <li key={exp.id} className="expense-item">
                <div className="expense-main">
                  <div className="expense-title">
                    <span>{exp.description}</span>
                    <span className="badge badge-neutral">{exp.category_name}</span>
                    {exp.installment_number && exp.total_installments && (
                      <span className="badge">
                        Parcela {exp.installment_number}/{exp.total_installments}
                      </span>
                    )}
                    {exp.recurring_period && (
                      <span className="badge">Recorrente {exp.recurring_period}</span>
                    )}
                    {exp.refunded_cents > 0 && (
                      <span className="badge badge-private">
                        Estornado {formatCentsBRL(exp.refunded_cents)}
                      </span>
                    )}
                    {exp.shared_at && <span className="badge">Compartilhada com a casa</span>}
                  </div>
                  <div className="expense-meta">
                    <span>Data: {exp.incurred_on}</span>
                    <span>· Pago por: {exp.paid_by_name}</span>
                    {exp.payment_method_name && (
                      <span>
                        · Meio: {exp.payment_method_name}
                        {exp.payment_method_last4 ? ` (•••• ${exp.payment_method_last4})` : ''}
                      </span>
                    )}
                    {exp.refunded_cents > 0 && (
                      <span>· Original: {formatCentsBRL(exp.amount_cents)}</span>
                    )}
                    {exp.notes && <span>· Obs.: {exp.notes}</span>}
                  </div>
                  {isCollective && exp.splits && exp.splits.length > 0 && (
                    <div className="expense-meta">
                      <span>
                        Rateio:{' '}
                        {exp.splits
                          .map(
                            (s) =>
                              `${s.user_name ?? 'Membro'}: ${formatCentsBRL(s.share_cents)}`,
                          )
                          .join(' · ')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="expense-right">
                  <span className="expense-value">{formatCentsBRL(exp.net_amount_cents)}</span>
                  <div className="expense-actions">
                    {!isCollective && !exp.installment_plan_id && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleShareExpense(exp)}
                      >
                        Compartilhar com a casa
                      </button>
                    )}
                    {exp.net_amount_cents > 0 && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => startRefund(exp)}
                      >
                        Estornar
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => startEditExpense(exp)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteExpense(exp)}
                    >
                      {exp.installment_plan_id ? 'Excluir parcela' : 'Excluir'}
                    </button>
                    {exp.installment_plan_id && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteInstallmentPlan(exp.installment_plan_id!)}
                      >
                        Excluir todas as parcelas
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
