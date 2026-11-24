import React, { useState } from 'react';
import {
  api,
  ApiError,
  Category,
  formatCentsBRL,
  Household,
  parseBRLToCents,
  PaymentKind,
  PaymentMethod,
  RecurringFrequency,
  RecurringRule,
  User,
} from '../api';

const RECURRING_FREQ_LABELS: Record<RecurringFrequency, string> = {
  monthly: 'Mensal (Assinatura mensal, Aluguel, Luz, Internet)',
  yearly: 'Anual (Assinatura anual, IPTU, IPVA, Seguro)',
  weekly: 'Semanal',
};

const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RecurringSectionProps {
  user: User;
  household: Household | null;
  activeWsId: string;
  isCollective: boolean;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  recurringRules: RecurringRule[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function RecurringSection({
  user,
  household,
  activeWsId,
  isCollective,
  categories,
  paymentMethods,
  recurringRules,
  onRefresh,
  onError,
}: RecurringSectionProps) {
  const [recDesc, setRecDesc] = useState('');
  const [recAmountInput, setRecAmountInput] = useState('');
  const [recFreq, setRecFreq] = useState<RecurringFrequency>('monthly');
  const [recStartDate, setRecStartDate] = useState(todayISO());
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id ?? '');
  const [recPaymentMethodId, setRecPaymentMethodId] = useState('');
  const [recPaidByUserId, setRecPaidByUserId] = useState(user.id);
  const [recNotes, setRecNotes] = useState('');

  const effectiveCatId = recCategoryId || categories[0]?.id || '';

  async function handleCreateRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWsId) return;
    onError(null);
    const cents = parseBRLToCents(recAmountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais para a assinatura ou conta recorrente.');
      return;
    }
    try {
      await api.createRecurringRule(activeWsId, {
        category_id: effectiveCatId,
        payment_method_id: recPaymentMethodId ? recPaymentMethodId : null,
        paid_by_user_id: isCollective ? recPaidByUserId : user.id,
        amount_cents: cents,
        description: recDesc,
        notes: recNotes,
        frequency: recFreq,
        start_date: recStartDate,
        split_strategy: 'equal',
      });
      setRecDesc('');
      setRecAmountInput('');
      setRecNotes('');
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar recorrência');
    }
  }

  async function handleToggleRecurring(rule: RecurringRule) {
    onError(null);
    try {
      await api.updateRecurringRule(rule.id, {
        category_id: rule.category_id,
        payment_method_id: rule.payment_method_id ?? null,
        paid_by_user_id: rule.paid_by_user_id,
        amount_cents: rule.amount_cents,
        description: rule.description,
        notes: rule.notes,
        frequency: rule.frequency,
        start_date: rule.next_due_date,
        end_date: rule.end_date ?? null,
        split_strategy: rule.split_strategy,
        is_active: !rule.is_active,
      });
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao atualizar recorrência');
    }
  }

  async function handleDeleteRecurring(id: string) {
    onError(null);
    try {
      await api.deleteRecurringRule(id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao excluir recorrência');
    }
  }

  async function handleGenerateRecurring() {
    if (!activeWsId) return;
    onError(null);
    try {
      await api.generateRecurringRules(activeWsId);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao gerar recorrências do mês');
    }
  }

  return (
    <section className="panel" aria-labelledby="recurring-title">
      <div className="summary-bar">
        <div>
          <h2 id="recurring-title">
            {isCollective
              ? 'Contas Recorrentes e Assinaturas da Família (Coletivo)'
              : 'Minhas Assinaturas e Contas Recorrentes (Individual)'}
          </h2>
          <p className="subtitle">
            Cadastre assinaturas mensais/anuais (Netflix, Spotify, Internet, Academia) e contas
            fixas ou variáveis (Aluguel, Luz, Água).
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleGenerateRecurring}>
          Gerar recorrências vencidas agora
        </button>
      </div>

      <form className="form-stack" onSubmit={handleCreateRecurring}>
        <div className="form-grid form-grid-3">
          <div className="field">
            <label htmlFor="rec-desc">Nome da assinatura ou conta</label>
            <input
              id="rec-desc"
              type="text"
              required
              maxLength={160}
              placeholder="Ex.: Netflix, Spotify, Conta de Luz, Condomínio"
              value={recDesc}
              onChange={(e) => setRecDesc(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rec-amount">Valor padrão / referência (R$)</label>
            <input
              id="rec-amount"
              type="text"
              inputMode="decimal"
              required
              placeholder="0,00"
              value={recAmountInput}
              onChange={(e) => setRecAmountInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rec-freq">Periodicidade</label>
            <select
              id="rec-freq"
              value={recFreq}
              onChange={(e) => setRecFreq(e.target.value as RecurringFrequency)}
            >
              {(Object.keys(RECURRING_FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {RECURRING_FREQ_LABELS[f]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-grid form-grid-3">
          <div className="field">
            <label htmlFor="rec-cat">Categoria</label>
            <select
              id="rec-cat"
              required
              value={effectiveCatId}
              onChange={(e) => setRecCategoryId(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rec-pm">Meio de pagamento (opcional)</label>
            <select
              id="rec-pm"
              value={recPaymentMethodId}
              onChange={(e) => setRecPaymentMethodId(e.target.value)}
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
          <div className="field">
            <label htmlFor="rec-start">Data do 1º / próximo vencimento</label>
            <input
              id="rec-start"
              type="date"
              required
              value={recStartDate}
              onChange={(e) => setRecStartDate(e.target.value)}
            />
          </div>
        </div>

        <div className="form-grid form-grid-2">
          {isCollective && household && (
            <div className="field">
              <label htmlFor="rec-paidby">Pago por</label>
              <select
                id="rec-paidby"
                value={recPaidByUserId}
                onChange={(e) => setRecPaidByUserId(e.target.value)}
              >
                {household.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.id === user.id ? '(você)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="rec-notes">Observações (opcional)</label>
            <input
              id="rec-notes"
              type="text"
              maxLength={500}
              placeholder="Ex.: Valor variável conforme fatura mensal"
              value={recNotes}
              onChange={(e) => setRecNotes(e.target.value)}
            />
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary">
            Cadastrar assinatura / recorrência
          </button>
        </div>
      </form>

      <div style={{ marginTop: '1.5rem' }}>
        <h3>Recorrências cadastradas neste ambiente ({recurringRules.length})</h3>
        {recurringRules.length === 0 ? (
          <p className="subtitle">Nenhuma assinatura ou conta recorrente cadastrada ainda.</p>
        ) : (
          <ul className="expense-list">
            {recurringRules.map((rule) => (
              <li key={rule.id} className="expense-item" style={{ padding: '0.85rem 1rem' }}>
                <div className="expense-main">
                  <div className="expense-title">
                    <span>{rule.description}</span>
                    <span className="badge badge-neutral">{rule.category_name}</span>
                    <span className={`badge ${rule.is_active ? 'badge-private' : 'badge-neutral'}`}>
                      {rule.is_active ? 'Ativa' : 'Pausada'}
                    </span>
                  </div>
                  <div className="expense-meta">
                    <span>Próximo lançamento: {rule.next_due_date}</span>
                    <span>· Pago por: {rule.paid_by_name}</span>
                    {rule.notes && <span>· {rule.notes}</span>}
                  </div>
                </div>
                <div className="expense-right">
                  <span className="expense-value">{formatCentsBRL(rule.amount_cents)}</span>
                  <div className="expense-actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => handleToggleRecurring(rule)}
                    >
                      {rule.is_active ? 'Pausar' : 'Reativar'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteRecurring(rule.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
