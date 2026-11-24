import React, { useState } from 'react';
import {
  api,
  ApiError,
  BalanceSummary,
  centsToInput,
  formatCentsBRL,
  Household,
  PairDebt,
  parseBRLToCents,
  Settlement,
  SettlementStatus,
  User,
} from '../api';

const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Aguardando confirmação do recebedor',
  confirmed: 'Confirmado',
  rejected: 'Recusado / Cancelado',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SettlementsSectionProps {
  user: User;
  household: Household | null;
  balances: BalanceSummary | null;
  settlements: Settlement[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
}

export function SettlementsSection({
  user,
  household,
  balances,
  settlements,
  onRefresh,
  onError,
}: SettlementsSectionProps) {
  const defaultOther =
    household?.members.find((m) => m.id !== user.id)?.id ?? household?.members[0]?.id ?? '';
  const [stFromUserId, setStFromUserId] = useState(user.id);
  const [stToUserId, setStToUserId] = useState(defaultOther);
  const [stAmountInput, setStAmountInput] = useState('');
  const [stPaidOn, setStPaidOn] = useState(todayISO());
  const [stNotes, setStNotes] = useState('');

  if (!household || !balances) {
    return (
      <section className="panel">
        <p className="subtitle">Carregando saldos da família…</p>
      </section>
    );
  }

  function prefillSettlement(pair: PairDebt) {
    setStFromUserId(pair.from_user_id);
    setStToUserId(pair.to_user_id);
    setStAmountInput(centsToInput(pair.amount_cents));
    setStPaidOn(todayISO());
    setStNotes(`Acerto de saldo: ${pair.from_user_name} → ${pair.to_user_name}`);
  }

  async function handleCreateSettlement(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    const cents = parseBRLToCents(stAmountInput);
    if (cents === null) {
      onError('Informe um valor válido em reais para o reembolso.');
      return;
    }
    try {
      await api.createSettlement({
        from_user_id: stFromUserId,
        to_user_id: stToUserId || defaultOther,
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
    <section className="panel" aria-labelledby="balances-title">
      <h2 id="balances-title">Saldos e Reembolsos da Família</h2>
      <p className="subtitle">
        Calculado automaticamente sobre as despesas do ambiente coletivo (descontando estornos) e
        reembolsos confirmados.
      </p>

      <div className="form-grid form-grid-2" style={{ marginTop: '1.25rem' }}>
        <div>
          <h3>Quem deve para quem</h3>
          {balances.pairwise.length === 0 ? (
            <p className="subtitle">Tudo quitado! Nenhuma dívida pendente entre membros.</p>
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
                    <strong>{formatCentsBRL(p.amount_cents)}</strong> para{' '}
                    <strong>{p.to_user_name}</strong>
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
                {mb.net_cents > 0
                  ? `tem a receber ${formatCentsBRL(mb.net_cents)}`
                  : mb.net_cents < 0
                    ? `deve ${formatCentsBRL(-mb.net_cents)}`
                    : 'zerado (R$ 0,00)'}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Registrar reembolso / pagamento</h3>
          <form className="form-stack" style={{ marginTop: '0.5rem' }} onSubmit={handleCreateSettlement}>
            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="st-from">Quem pagou (devedor)</label>
                <select
                  id="st-from"
                  value={stFromUserId}
                  onChange={(e) => setStFromUserId(e.target.value)}
                >
                  {household.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === user.id ? '(você)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-to">Quem recebeu (credor)</label>
                <select
                  id="st-to"
                  value={stToUserId || defaultOther}
                  onChange={(e) => setStToUserId(e.target.value)}
                >
                  {household.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === user.id ? '(você)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="st-amount">Valor (R$)</label>
                <input
                  id="st-amount"
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0,00"
                  value={stAmountInput}
                  onChange={(e) => setStAmountInput(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="st-date">Data do pagamento</label>
                <input
                  id="st-date"
                  type="date"
                  required
                  value={stPaidOn}
                  onChange={(e) => setStPaidOn(e.target.value)}
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
              <p className="field-hint">
                Se você for quem pagou, o reembolso ficará aguardando confirmação de quem recebeu.
                Se você for quem recebeu, já entra confirmado.
              </p>
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
                            ? ''
                            : 'badge-neutral'
                      }`}
                    >
                      {SETTLEMENT_STATUS_LABELS[st.status]}
                    </span>
                  </div>
                  <div className="expense-meta">
                    <span>Data: {st.paid_on}</span>
                    {st.notes && <span>· {st.notes}</span>}
                  </div>
                </div>

                <div className="expense-right">
                  <span className="expense-value">{formatCentsBRL(st.amount_cents)}</span>
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
                          Recusar / Cancelar
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
