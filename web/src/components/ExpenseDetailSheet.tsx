import React, { useEffect, useState } from 'react';
import { api, ApiError, centsToInput, Expense, parseBRLToCents } from '../api';
import { formatMoneyDisplay } from '../utils/format';
import { formatDateBR, toLocalISODate } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { MoneyInput } from './MoneyInput';
import { DateInput } from './ui/DateInput';

export function ExpenseDetailSheet({
  expense,
  isCollective,
  hideValues,
  onClose,
  onEdit,
  onRefresh,
  onError,
}: {
  expense: Expense | null;
  isCollective: boolean;
  hideValues: boolean;
  onClose: () => void;
  onEdit: (exp: Expense) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundDate, setRefundDate] = useState(toLocalISODate());
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setShowRefundForm(false);
    setRefundAmountInput(centsToInput(expense.net_amount_cents));
    setRefundDate(toLocalISODate());
    setRefundReason('');
    setLocalError(null);
  }, [expense]);

  useEffect(() => {
    if (!expense) return;
    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expense, onClose]);

  if (!expense) return null;

  const currentExpense = expense;

  async function handleCreateRefund(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    onError(null);
    const cents = parseBRLToCents(refundAmountInput);
    if (cents === null || cents > currentExpense.net_amount_cents) {
      setLocalError('Informe um valor válido em reais até o limite do saldo líquido.');
      return;
    }
    setBusy(true);
    try {
      await api.createRefund(currentExpense.id, {
        amount_cents: cents,
        refunded_on: refundDate,
        reason: refundReason,
      });
      await onRefresh();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao registrar estorno';
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setLocalError(null);
    onError(null);
    setBusy(true);
    try {
      await api.shareExpenseWithHousehold(currentExpense.id);
      await onRefresh();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Erro ao compartilhar despesa com a casa';
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSingle() {
    setLocalError(null);
    onError(null);
    setBusy(true);
    try {
      await api.deleteExpense(currentExpense.id);
      await onRefresh();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao excluir despesa';
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePlan() {
    if (!currentExpense.installment_plan_id) return;
    setLocalError(null);
    onError(null);
    setBusy(true);
    try {
      await api.deleteInstallmentPlan(currentExpense.installment_plan_id);
      await onRefresh();
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao excluir parcelamento completo';
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-dialog">
        <div className="sheet-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <CategoryIconBadge
              name={currentExpense.category_name}
              categoryId={currentExpense.category_id}
            />
            <div style={{ minWidth: 0 }}>
              <h2 id="detail-sheet-title" className="sheet-title">
                {currentExpense.description}
              </h2>
              <p className="subtitle" style={{ margin: 0 }}>
                {currentExpense.category_name} · {formatDateBR(currentExpense.incurred_on)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar detalhes"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="sheet-body">
          {localError && (
            <div className="alert-error" role="alert">
              <span>{localError}</span>
            </div>
          )}

          {/* Resumo de valor líquido, original e estornos */}
          <div className="amount-hero-box" style={{ alignItems: 'flex-start' }}>
            <span className="amount-hero-label">Valor líquido</span>
            <div style={{ fontSize: '1.85rem', fontWeight: 800 }} className="tabular-nums">
              {formatMoneyDisplay(currentExpense.net_amount_cents, hideValues)}
            </div>
            {currentExpense.refunded_cents > 0 && (
              <div className="expense-meta" style={{ marginTop: '0.25rem' }}>
                <span>
                  Original: {formatMoneyDisplay(currentExpense.amount_cents, hideValues)}
                </span>
                <span>
                  · Estornado:{' '}
                  <strong className="text-positive">
                    {formatMoneyDisplay(currentExpense.refunded_cents, hideValues)}
                  </strong>
                </span>
              </div>
            )}
          </div>

          {/* Badges e Metadados */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '1rem' }}>
            <span className="badge badge-neutral">Pago por: {currentExpense.paid_by_name}</span>
            {currentExpense.payment_method_name && (
              <span className="badge badge-neutral">
                Meio: {currentExpense.payment_method_name}
                {currentExpense.payment_method_last4
                  ? ` (•••• ${currentExpense.payment_method_last4})`
                  : ''}
              </span>
            )}
            {currentExpense.installment_number && currentExpense.total_installments && (
              <span className="badge">
                Parcela {currentExpense.installment_number}/{currentExpense.total_installments}
              </span>
            )}
            {currentExpense.recurring_period && (
              <span className="badge">Recorrente ({currentExpense.recurring_period})</span>
            )}
            {currentExpense.shared_at && (
              <span className="badge badge-private">Compartilhada com a casa</span>
            )}
          </div>

          {currentExpense.notes && (
            <div className="panel" style={{ padding: '0.85rem 1rem', background: 'var(--surface-2)' }}>
              <strong style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Observação:
              </strong>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.92rem' }}>
                {currentExpense.notes}
              </p>
            </div>
          )}

          {/* Divisão entre familiares (quando coletivo) */}
          {isCollective && currentExpense.splits && currentExpense.splits.length > 0 && (
            <div className="panel" style={{ padding: '0.9rem 1rem', background: 'var(--surface-2)' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Rateio entre familiares</h3>
              <ul className="expense-list">
                {currentExpense.splits.map((s) => (
                  <li
                    key={s.user_id}
                    className="expense-item"
                    style={{ padding: '0.55rem 0.85rem', background: 'var(--surface-1)' }}
                  >
                    <span>{s.user_name ?? 'Familiar'}</span>
                    <strong className="tabular-nums">
                      {formatMoneyDisplay(s.share_cents, hideValues)}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Formulário expansível de Estorno Parcial/Total */}
          {showRefundForm && (
            <form
              className="panel"
              style={{ background: 'var(--surface-2)', marginBottom: 0 }}
              onSubmit={handleCreateRefund}
            >
              <h3>
                Registrar estorno (disponível:{' '}
                {formatMoneyDisplay(currentExpense.net_amount_cents, hideValues)})
              </h3>
              <div className="form-grid form-grid-2">
                <div className="field">
                  <label htmlFor="detail-ref-amount">Valor a estornar</label>
                  <MoneyInput
                    id="detail-ref-amount"
                    required
                    maxCents={currentExpense.net_amount_cents}
                    value={refundAmountInput}
                    onChange={setRefundAmountInput}
                  />
                </div>
                <div className="field">
                  <label htmlFor="detail-ref-date">Data do estorno</label>
                  <DateInput
                    id="detail-ref-date"
                    required
                    showShortcuts
                    value={refundDate}
                    onChange={setRefundDate}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: '0.65rem' }}>
                <label htmlFor="detail-ref-reason">Motivo (opcional)</label>
                <input
                  id="detail-ref-reason"
                  type="text"
                  maxLength={300}
                  placeholder="Ex.: Devolução parcial, cobrança duplicada"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
              </div>
              <div className="user-bar" style={{ marginTop: '0.85rem' }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  Confirmar estorno
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowRefundForm(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="sheet-footer" style={{ justifyContent: 'space-between' }}>
          <div className="user-bar">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                onClose();
                onEdit(currentExpense);
              }}
            >
              Editar
            </button>

            {currentExpense.net_amount_cents > 0 && !showRefundForm && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={() => setShowRefundForm(true)}
              >
                Estornar
              </button>
            )}

            {!isCollective && !currentExpense.installment_plan_id && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={busy}
                onClick={handleShare}
              >
                Compartilhar com a casa
              </button>
            )}
          </div>

          <div className="user-bar">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={handleDeleteSingle}
            >
              {currentExpense.installment_plan_id ? 'Excluir parcela' : 'Excluir'}
            </button>

            {currentExpense.installment_plan_id && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={handleDeletePlan}
              >
                Excluir todas as parcelas
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
