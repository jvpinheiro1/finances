import React, { useState } from 'react';
import {
  api,
  ApiError,
  Category,
  Household,
  parseBRLToCents,
  PaymentKind,
  PaymentMethod,
  RecurringFrequency,
  RecurringRule,
  User,
} from '../api';
import { formatMoneyDisplay } from '../utils/format';
import { formatDateBR, toLocalISODate } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { MoneyInput } from './MoneyInput';
import { DateInput } from './ui/DateInput';
import { SelectField } from './ui/SelectField';

const RECURRING_FREQ_LABELS: Record<RecurringFrequency, string> = {
  monthly: 'Mensal',
  yearly: 'Anual',
  weekly: 'Semanal',
};

const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit: 'Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};

interface RecurringSectionProps {
  user: User;
  household: Household | null;
  activeWsId: string;
  isCollective: boolean;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  recurringRules: RecurringRule[];
  hideValues?: boolean;
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
  hideValues = false,
  onRefresh,
  onError,
}: RecurringSectionProps) {
  const [recDesc, setRecDesc] = useState('');
  const [descTouched, setDescTouched] = useState(false);
  const [recAmountInput, setRecAmountInput] = useState('');
  const [recFreq, setRecFreq] = useState<RecurringFrequency>('monthly');
  const [recStartDate, setRecStartDate] = useState(toLocalISODate());
  const [recCategoryId, setRecCategoryId] = useState(categories[0]?.id ?? '');
  const [recPaymentMethodId, setRecPaymentMethodId] = useState('');
  const [recPaidByUserId, setRecPaidByUserId] = useState(user.id);
  const [recNotes, setRecNotes] = useState('');

  const effectiveCatId = recCategoryId || categories[0]?.id || '';
  const descError =
    descTouched && !recDesc.trim() ? 'Informe o nome da assinatura ou conta.' : null;

  async function handleCreateRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWsId) return;
    onError(null);
    setDescTouched(true);

    if (!recDesc.trim()) {
      onError('Informe o nome da assinatura ou conta.');
      return;
    }
    const cents = parseBRLToCents(recAmountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais.');
      return;
    }
    try {
      await api.createRecurringRule(activeWsId, {
        category_id: effectiveCatId,
        payment_method_id: recPaymentMethodId ? recPaymentMethodId : null,
        paid_by_user_id: isCollective ? recPaidByUserId : user.id,
        amount_cents: cents,
        description: recDesc.trim(),
        notes: recNotes,
        frequency: recFreq,
        start_date: recStartDate,
        split_strategy: 'equal',
      });
      setRecDesc('');
      setDescTouched(false);
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
    <section className="panel" aria-label="Recorrentes e Assinaturas">
      <div className="summary-bar">
        <h2>{isCollective ? 'Coletivo' : 'Individual 🔒'} · Nova recorrência</h2>
        <button type="button" className="btn btn-outline btn-sm" onClick={handleGenerateRecurring}>
          Gerar vencidas agora
        </button>
      </div>

      <form className="form-stack" onSubmit={handleCreateRecurring}>
        <div className="form-grid form-grid-3">
          <div className="field">
            <label htmlFor="rec-desc">Nome da assinatura ou conta</label>
            <input
              id="rec-desc"
              className={descError ? 'input-invalid' : ''}
              type="text"
              required
              maxLength={160}
              placeholder="Ex.: Netflix, Luz, Condomínio"
              value={recDesc}
              onChange={(e) => setRecDesc(e.target.value)}
              onBlur={() => setDescTouched(true)}
            />
            {descError && (
              <span className="field-error" role="alert">
                {descError}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="rec-amount">Valor padrão</label>
            <MoneyInput
              id="rec-amount"
              required
              value={recAmountInput}
              onChange={setRecAmountInput}
            />
          </div>
          <div className="field">
            <label htmlFor="rec-freq">Periodicidade</label>
            <SelectField
              id="rec-freq"
              value={recFreq}
              onChange={(e) => setRecFreq(e.target.value as RecurringFrequency)}
            >
              {(Object.keys(RECURRING_FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {RECURRING_FREQ_LABELS[f]}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        <div className="form-grid form-grid-3">
          <div className="field">
            <label htmlFor="rec-cat">Categoria</label>
            <SelectField
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
            </SelectField>
          </div>
          <div className="field">
            <label htmlFor="rec-pm">Meio de pagamento (opcional)</label>
            <SelectField
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
            </SelectField>
          </div>
          <div className="field">
            <label htmlFor="rec-start">Próximo vencimento</label>
            <DateInput
              id="rec-start"
              required
              value={recStartDate}
              onChange={setRecStartDate}
            />
          </div>
        </div>

        <div className="form-grid form-grid-2">
          {isCollective && household && (
            <div className="field">
              <label htmlFor="rec-paidby">Pago por</label>
              <SelectField
                id="rec-paidby"
                value={recPaidByUserId}
                onChange={(e) => setRecPaidByUserId(e.target.value)}
              >
                {household.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.id === user.id ? '(você)' : ''}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          <div className="field">
            <label htmlFor="rec-notes">Observações (opcional)</label>
            <input
              id="rec-notes"
              type="text"
              maxLength={500}
              placeholder="Ex.: Valor variável conforme fatura"
              value={recNotes}
              onChange={(e) => setRecNotes(e.target.value)}
            />
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary">
            Cadastrar recorrência
          </button>
        </div>
      </form>

      <div style={{ marginTop: '1.5rem' }}>
        <h3>Cadastradas ({recurringRules.length})</h3>
        {recurringRules.length === 0 ? (
          <p className="subtitle">Nenhuma assinatura ou conta recorrente cadastrada.</p>
        ) : (
          <ul className="expense-list">
            {recurringRules.map((rule) => (
              <li key={rule.id} className="expense-item" style={{ padding: '0.85rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                  <CategoryIconBadge name={rule.category_name} categoryId={rule.category_id} />
                  <div className="expense-main">
                    <div className="expense-title">
                      <span>{rule.description}</span>
                      <span className="badge badge-neutral">{rule.category_name}</span>
                      <span
                        className={`badge ${rule.is_active ? 'badge-private' : 'badge-neutral'}`}
                      >
                        {rule.is_active ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <div className="expense-meta">
                      <span>Próximo: {formatDateBR(rule.next_due_date)}</span>
                      <span>· {rule.paid_by_name}</span>
                      {rule.notes && <span>· {rule.notes}</span>}
                    </div>
                  </div>
                </div>
                <div className="expense-right">
                  <span className="expense-value">
                    {formatMoneyDisplay(rule.amount_cents, hideValues)}
                  </span>
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
