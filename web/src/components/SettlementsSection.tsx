import React, { useState } from 'react';
import {
  api,
  ApiError,
  BalanceSummary,
  centsToInput,
  Household,
  PairDebt,
  parseBRLToCents,
  Settlement,
  SettlementStatus,
  User,
} from '../api';
import { formatMoneyDisplay } from '../utils/format';
import { formatDateBR, toLocalISODate } from '../utils/period';
import { MoneyInput } from './MoneyInput';
import { DateInput } from './ui/DateInput';
import { SelectField } from './ui/SelectField';

const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Aguardando confirmação',
  confirmed: 'Confirmado',
  rejected: 'Cancelado',
};

interface SettlementsSectionProps {
  user: User;
  household: Household | null;
  balances: BalanceSummary | null;
  settlements: Settlement[];
  hideValues?: boolean;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function SettlementsSection({
  user,
  household,
  balances,
  settlements,
  hideValues = false,
  onRefresh,
  onError,
}: SettlementsSectionProps) {
  const defaultOther =
    household?.members.find((m) => m.id !== user.id)?.id ?? household?.members[0]?.id ?? '';
  const [stFromUserId, setStFromUserId] = useState(user.id);
  const [stToUserId, setStToUserId] = useState(defaultOther);
  const [stAmountInput, setStAmountInput] = useState('');
  const [stPaidOn, setStPaidOn] = useState(toLocalISODate());
  const [stNotes, setStNotes] = useState('');

  if (!household || !balances) {
    return (
      <section className="panel">
        <p className="subtitle">Carregando saldos…</p>
      </section>
    );
  }

  const effectiveToUserId = stToUserId || defaultOther;
  const samePersonError =
    stFromUserId && effectiveToUserId && stFromUserId === effectiveToUserId
      ? 'O pagador e o recebedor devem ser familiares diferentes.'
      : null;

  function prefillSettlement(pair: PairDebt) {
    setStFromUserId(pair.from_user_id);
    setStToUserId(pair.to_user_id);
    setStAmountInput(centsToInput(pair.amount_cents));
    setStPaidOn(toLocalISODate());
    setStNotes(`Acerto: ${pair.from_user_name} → ${pair.to_user_name}`);
  }

  async function handleCreateSettlement(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    if (samePersonError) {
      onError(samePersonError);
      return;
    }
    const cents = parseBRLToCents(stAmountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais para o reembolso.');
      return;
    }
    try {
      await api.createSettlement({
        from_user_id: stFromUserId,
        to_user_id: effectiveToUserId,
        amount_cents: cents,
        paid_on: stPaidOn,
        notes: stNotes,
      });
      setStAmountInput('');
      setStNotes('');
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao registrar reembolso');
    }
  }

  async function handleConfirmSettlement(id: string) {
    onError(null);
    try {
      await api.confirmSettlement(id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao confirmar reembolso');
    }
  }

  async function handleRejectSettlement(id: string) {
    onError(null);
    try {
      await api.rejectSettlement(id);
      await onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao recusar reembolso');
    }
  }

  return (
    <section className="panel" aria-label="Saldos e Reembolsos">
      <div className="form-grid form-grid-2">
        <div>
          <h3>Quem deve para quem</h3>
          {balances.pairwise.length === 0 ? (
            <p className="subtitle">Tudo quitado entre os membros da casa.</p>
          ) : (
            <ul className="expense-list">
              {balances.pairwise.map((p) => (
                <li
                  key={`${p.from_user_id}-${p.to_user_id}`}
                  className="expense-item"
                  style={{ padding: '0.75rem 1rem' }}
                >
                  <div>
                    <strong>{p.from_user_name}</strong> deve{' '}
                    <strong className="tabular-nums">
                      {formatMoneyDisplay(p.amount_cents, hideValues)}
                    </strong>{' '}
                    para <strong>{p.to_user_name}</strong>
                  </div>
                  {(user.id === p.from_user_id || user.id === p.to_user_id) && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => prefillSettlement(p)}
                    >
                      Preencher pagamento
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 style={{ marginTop: '1.25rem' }}>Posição líquida por membro</h3>
          <ul className="member-list">
            {balances.members.map((mb) => (
              <li key={mb.user_id} className="member-chip">
                <strong>{mb.user_name}</strong>:{' '}
                <span
                  className={`tabular-nums ${
                    mb.net_cents > 0 ? 'text-positive' : mb.net_cents < 0 ? 'text-negative' : ''
                  }`}
                >
                  {mb.net_cents > 0
                    ? `a receber ${formatMoneyDisplay(mb.net_cents, hideValues)}`
                    : mb.net_cents < 0
                      ? `deve ${formatMoneyDisplay(-mb.net_cents, hideValues)}`
                      : `quitado (${formatMoneyDisplay(0, hideValues)})`}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Registrar reembolso</h3>
          <form
            className="form-stack"
            style={{ marginTop: '0.5rem' }}
            onSubmit={handleCreateSettlement}
          >
            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="st-from">Quem pagou</label>
                <SelectField
                  id="st-from"
                  value={stFromUserId}
                  onChange={(e) => setStFromUserId(e.target.value)}
                >
                  {household.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === user.id ? '(você)' : ''}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="field">
                <label htmlFor="st-to">Quem recebeu</label>
                <SelectField
                  id="st-to"
                  value={effectiveToUserId}
                  error={samePersonError}
                  onChange={(e) => setStToUserId(e.target.value)}
                >
                  {household.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === user.id ? '(você)' : ''}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>

            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="st-amount">Valor</label>
                <MoneyInput
                  id="st-amount"
                  required
                  value={stAmountInput}
                  onChange={setStAmountInput}
                />
              </div>
              <div className="field">
                <label htmlFor="st-date">Data</label>
                <DateInput
                  id="st-date"
                  required
                  showShortcuts
                  value={stPaidOn}
                  onChange={setStPaidOn}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="st-notes">Observação (opcional)</label>
              <input
                id="st-notes"
                type="text"
                maxLength={500}
                placeholder="Ex.: PIX enviado"
                value={stNotes}
                onChange={(e) => setStNotes(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Registrar reembolso
            </button>
          </form>
        </div>
      </div>

      {settlements.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3>Histórico de reembolsos</h3>
          <ul className="expense-list">
            {settlements.map((st) => (
              <li key={st.id} className="expense-item" style={{ padding: '0.85rem 1rem' }}>
                <div className="expense-main">
                  <div className="expense-title">
                    <span>
                      {st.from_user_name} → {st.to_user_name}
                    </span>
                    <span
                      className={`badge ${
                        st.status === 'confirmed'
                          ? 'badge-private'
                          : st.status === 'pending'
                            ? 'badge-warning'
                            : 'badge-neutral'
                      }`}
                    >
                      {SETTLEMENT_STATUS_LABELS[st.status]}
                    </span>
                  </div>
                  <div className="expense-meta">
                    <span>{formatDateBR(st.paid_on)}</span>
                    {st.notes && <span>· {st.notes}</span>}
                  </div>
                </div>

                <div className="expense-right">
                  <span className="expense-value">
                    {formatMoneyDisplay(st.amount_cents, hideValues)}
                  </span>
                  {st.status === 'pending' && (
                    <div className="expense-actions">
                      {user.id === st.to_user_id && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleConfirmSettlement(st.id)}
                        >
                          Confirmar recebimento
                        </button>
                      )}
                      {(user.id === st.to_user_id || user.id === st.from_user_id) && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRejectSettlement(st.id)}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
