import React, { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  Category,
  centsToInput,
  Expense,
  Household,
  parseBRLToCents,
  parsePercentToBps,
  PaymentKind,
  PaymentMethod,
  SplitInput,
  SplitStrategy,
  User,
} from '../api';
import { toLocalISODate } from '../utils/period';
import { CategoryIconBadge } from './CategoryIconBadge';
import { MoneyInput } from './MoneyInput';
import { DateInput } from './ui/DateInput';
import { SelectField } from './ui/SelectField';

const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit: 'Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};

const QUICK_PAYMENT_PRESETS: { name: string; kind: PaymentKind }[] = [
  { name: 'PIX', kind: 'pix' },
  { name: 'Cartão de Crédito', kind: 'credit_card' },
  { name: 'Cartão de Débito', kind: 'debit' },
  { name: 'Dinheiro', kind: 'cash' },
];

const SPLIT_STRATEGY_LABELS: Record<SplitStrategy, string> = {
  equal: 'Partes iguais',
  exact: 'Valor exato (R$)',
  percentage: 'Porcentagem (%)',
  shares: 'Cotas / Pesos',
};

export function ExpenseFormSheet({
  open,
  onClose,
  editingExpense,
  user,
  household,
  activeWsId,
  isCollective,
  categories,
  paymentMethods,
  onPaymentMethodCreated,
  onSaved,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  editingExpense: Expense | null;
  user: User;
  household: Household | null;
  activeWsId: string;
  isCollective: boolean;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  onPaymentMethodCreated?: (pm: PaymentMethod) => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [description, setDescription] = useState('');
  const [descTouched, setDescTouched] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [incurredOn, setIncurredOn] = useState(toLocalISODate());
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paidByUserId, setPaidByUserId] = useState(user.id);
  const [totalInstallments, setTotalInstallments] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>({});
  const [splitCustomValues, setSplitCustomValues] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Estado para criação rápida de meio de pagamento sem sair do modal
  const [showQuickPmForm, setShowQuickPmForm] = useState(false);
  const [quickPmName, setQuickPmName] = useState('');
  const [quickPmKind, setQuickPmKind] = useState<PaymentKind>('pix');
  const [quickPmBusy, setQuickPmBusy] = useState(false);
  const [quickPmError, setQuickPmError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    setDescTouched(false);
    setShowQuickPmForm(false);
    setQuickPmName('');
    setQuickPmError(null);

    if (editingExpense) {
      setDescription(editingExpense.description);
      setAmountInput(centsToInput(editingExpense.amount_cents));
      setIncurredOn(editingExpense.incurred_on);
      setCategoryId(editingExpense.category_id);
      setPaymentMethodId(editingExpense.payment_method_id ?? '');
      setPaidByUserId(editingExpense.paid_by_user_id);
      setTotalInstallments(1);
      setNotes(editingExpense.notes);
      setSplitStrategy(editingExpense.split_strategy || 'equal');
      setShowAdvanced(
        Boolean(
          (editingExpense.split_strategy && editingExpense.split_strategy !== 'equal') ||
            editingExpense.paid_by_user_id !== user.id,
        ),
      );

      if (household && editingExpense.splits && editingExpense.splits.length > 0) {
        const partMap: Record<string, boolean> = {};
        const valMap: Record<string, string> = {};
        for (const m of household.members) {
          partMap[m.id] = false;
        }
        for (const sp of editingExpense.splits) {
          partMap[sp.user_id] = true;
          if (editingExpense.split_strategy === 'exact') {
            valMap[sp.user_id] = centsToInput(sp.share_cents);
          } else if (editingExpense.split_strategy === 'percentage' && sp.weight_bps) {
            valMap[sp.user_id] = (sp.weight_bps / 100).toFixed(2).replace('.', ',');
          } else if (editingExpense.split_strategy === 'shares' && sp.weight_bps) {
            valMap[sp.user_id] = String(sp.weight_bps);
          }
        }
        setSelectedParticipants(partMap);
        setSplitCustomValues(valMap);
      } else {
        const map: Record<string, boolean> = {};
        for (const m of household?.members ?? []) {
          map[m.id] = true;
        }
        setSelectedParticipants(map);
        setSplitCustomValues({});
      }
    } else {
      setDescription('');
      setAmountInput('');
      setIncurredOn(toLocalISODate());
      setCategoryId(categories[0]?.id ?? '');
      setPaymentMethodId('');
      setPaidByUserId(user.id);
      setTotalInstallments(1);
      setNotes('');
      setSplitStrategy('equal');
      setShowAdvanced(false);
      const map: Record<string, boolean> = {};
      for (const m of household?.members ?? []) {
        map[m.id] = true;
      }
      setSelectedParticipants(map);
      setSplitCustomValues({});
    }
  }, [open, editingExpense, categories, household, user.id]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const effectiveCatId = categoryId || categories[0]?.id || '';

  function reportFormError(msg: string) {
    setLocalError(msg);
    onError(msg);
  }

  async function handleOneClickPreset(preset: { name: string; kind: PaymentKind }) {
    // Verifica se já existe um meio com mesmo tipo/nome
    const existing = paymentMethods.find(
      (pm) => pm.kind === preset.kind || pm.name.toLowerCase() === preset.name.toLowerCase(),
    );
    if (existing) {
      setPaymentMethodId(existing.id);
      return;
    }
    setQuickPmBusy(true);
    setQuickPmError(null);
    try {
      const created = await api.createPaymentMethod({
        name: preset.name,
        kind: preset.kind,
        is_personal: !isCollective,
      });
      onPaymentMethodCreated?.(created);
      setPaymentMethodId(created.id);
    } catch (err) {
      setQuickPmError(
        err instanceof ApiError ? err.message : 'Não foi possível criar meio de pagamento',
      );
    } finally {
      setQuickPmBusy(false);
    }
  }

  async function handleCreateQuickPm() {
    if (!quickPmName.trim()) {
      setQuickPmError('Informe um nome para o meio de pagamento.');
      return;
    }
    setQuickPmBusy(true);
    setQuickPmError(null);
    try {
      const created = await api.createPaymentMethod({
        name: quickPmName.trim(),
        kind: quickPmKind,
        is_personal: !isCollective,
      });
      onPaymentMethodCreated?.(created);
      setPaymentMethodId(created.id);
      setQuickPmName('');
      setShowQuickPmForm(false);
    } catch (err) {
      setQuickPmError(
        err instanceof ApiError ? err.message : 'Não foi possível criar meio de pagamento',
      );
    } finally {
      setQuickPmBusy(false);
    }
  }

  // Cálculo inline para validação de divisão (porcentagem = 100%, ou valor exato = total)
  const activeParticipantIds = (household?.members ?? [])
    .filter((m) => selectedParticipants[m.id] !== false)
    .map((m) => m.id);

  let splitInlineError: string | null = null;
  if (isCollective && household) {
    if (activeParticipantIds.length === 0) {
      splitInlineError = 'Selecione pelo menos 1 familiar participante.';
    } else if (splitStrategy === 'percentage') {
      let sumBps = 0;
      let anyFilled = false;
      for (const id of activeParticipantIds) {
        const raw = splitCustomValues[id] ?? '';
        if (raw.trim()) {
          anyFilled = true;
          const bps = parsePercentToBps(raw);
          if (bps !== null) sumBps += bps;
        }
      }
      if (anyFilled && sumBps !== 10000) {
        splitInlineError = `A soma das porcentagens deve ser 100% (atual: ${(sumBps / 100).toFixed(2).replace('.', ',')}%).`;
      }
    } else if (splitStrategy === 'exact') {
      const totalCents = parseBRLToCents(amountInput);
      let sumCents = 0;
      let anyFilled = false;
      for (const id of activeParticipantIds) {
        const raw = splitCustomValues[id] ?? '';
        if (raw.trim()) {
          anyFilled = true;
          const c = parseBRLToCents(raw);
          if (c !== null) sumCents += c;
        }
      }
      if (anyFilled && totalCents !== null && sumCents !== totalCents) {
        splitInlineError = `A soma dos valores individuais (R$ ${centsToInput(sumCents)}) deve ser igual ao valor da despesa (R$ ${centsToInput(totalCents)}).`;
      }
    }
  }

  const installmentsError =
    !editingExpense && (totalInstallments < 1 || totalInstallments > 48)
      ? 'O número de parcelas deve estar entre 1 e 48.'
      : null;

  const descError =
    descTouched && !description.trim() ? 'Informe uma descrição para a despesa.' : null;

  function buildSplitsInput(): SplitInput[] | null {
    if (!isCollective || !household) return [];
    if (activeParticipantIds.length === 0) {
      reportFormError('Selecione pelo menos 1 familiar participante na divisão.');
      return null;
    }
    if (splitStrategy === 'equal') {
      return activeParticipantIds.map((id) => ({ user_id: id }));
    }

    const out: SplitInput[] = [];
    for (const id of activeParticipantIds) {
      const raw = splitCustomValues[id] ?? '';
      if (splitStrategy === 'exact') {
        const cents = parseBRLToCents(raw);
        if (cents === null) {
          reportFormError('Informe um valor válido em R$ para cada participante selecionado.');
          return null;
        }
        out.push({ user_id: id, share_cents: cents });
      } else if (splitStrategy === 'percentage') {
        const bps = parsePercentToBps(raw);
        if (bps === null) {
          reportFormError(
            'Informe uma porcentagem válida para cada participante (soma deve ser 100%).',
          );
          return null;
        }
        out.push({ user_id: id, weight_bps: bps });
      } else if (splitStrategy === 'shares') {
        const w = parseInt(raw.trim(), 10);
        if (!Number.isInteger(w) || w <= 0) {
          reportFormError('Informe um número inteiro positivo de cotas para cada participante.');
          return null;
        }
        out.push({ user_id: id, weight_bps: w });
      }
    }
    if (splitInlineError) {
      reportFormError(splitInlineError);
      return null;
    }
    return out;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWsId) return;
    setLocalError(null);
    onError(null);
    setDescTouched(true);

    const cents = parseBRLToCents(amountInput);
    if (cents === null) {
      reportFormError('Informe um valor válido em reais (ex.: 23,33).');
      return;
    }
    if (!description.trim()) {
      reportFormError('Informe uma descrição para a despesa.');
      return;
    }
    if (installmentsError) {
      reportFormError(installmentsError);
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
        description: description.trim(),
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
      await onSaved();
      onClose();
    } catch (err) {
      reportFormError(err instanceof ApiError ? err.message : 'Erro ao salvar despesa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-dialog">
        <div className="sheet-header">
          <h2 id="expense-sheet-title" className="sheet-title">
            {editingExpense
              ? 'Editar despesa'
              : isCollective
                ? 'Nova despesa · Coletivo'
                : 'Nova despesa · Individual 🔒'}
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar formulário"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
        >
          <div className="sheet-body">
            {localError && (
              <div className="alert-error" role="alert">
                <span>{localError}</span>
              </div>
            )}

            {/* Valor grande em destaque no topo com MoneyInput validado */}
            <div className="amount-hero-box">
              <label htmlFor="sheet-exp-amount" className="amount-hero-label">
                {totalInstallments > 1 ? 'Valor total da compra' : 'Valor da despesa'}
              </label>
              <MoneyInput
                id="sheet-exp-amount"
                variant="hero"
                required
                autoFocus
                value={amountInput}
                onChange={setAmountInput}
              />
            </div>

            {/* Grade de Categorias com Ícones Circulares */}
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label id="cat-grid-label">Categoria</label>
              <div
                className="category-grid"
                role="radiogroup"
                aria-labelledby="cat-grid-label"
              >
                {categories.map((cat) => {
                  const selected = cat.id === effectiveCatId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="category-grid-item"
                      onClick={() => setCategoryId(cat.id)}
                    >
                      <CategoryIconBadge name={cat.name} categoryId={cat.id} />
                      <span className="category-grid-name">{cat.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-grid form-grid-2">
              <div className="field">
                <label htmlFor="sheet-exp-desc">Descrição</label>
                <input
                  id="sheet-exp-desc"
                  className={descError ? 'input-invalid' : ''}
                  type="text"
                  required
                  maxLength={160}
                  placeholder="Ex.: Supermercado, Padaria, Uber"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => setDescTouched(true)}
                />
                {descError && (
                  <span className="field-error" role="alert">
                    {descError}
                  </span>
                )}
              </div>

              <div className="field">
                <label htmlFor="sheet-exp-date">Data</label>
                <DateInput
                  id="sheet-exp-date"
                  required
                  showShortcuts
                  value={incurredOn}
                  onChange={setIncurredOn}
                />
              </div>
            </div>

            {/* Seleção de Meio de Pagamento com Chips Rápidos + Criação Inline */}
            <div className="field" style={{ marginTop: '0.9rem' }}>
              <label>Meio de pagamento</label>
              <div className="pm-chips-row" role="group" aria-label="Escolha o meio de pagamento">
                <button
                  type="button"
                  className="pm-chip"
                  aria-pressed={paymentMethodId === ''}
                  onClick={() => setPaymentMethodId('')}
                >
                  Não informado
                </button>

                {paymentMethods.map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    className="pm-chip"
                    aria-pressed={paymentMethodId === pm.id}
                    onClick={() => setPaymentMethodId(pm.id)}
                  >
                    {pm.name}
                    {pm.last4 ? ` ••${pm.last4}` : ''}
                  </button>
                ))}

                {/* Se ainda não houver meios cadastrados, oferece botões rápidos de 1 clique */}
                {paymentMethods.length === 0 &&
                  QUICK_PAYMENT_PRESETS.map((preset) => (
                    <button
                      key={preset.kind}
                      type="button"
                      className="pm-chip"
                      disabled={quickPmBusy}
                      onClick={() => handleOneClickPreset(preset)}
                    >
                      + Usar {preset.name}
                    </button>
                  ))}

                <button
                  type="button"
                  className="pm-chip pm-chip-add"
                  aria-expanded={showQuickPmForm}
                  onClick={() => setShowQuickPmForm((v) => !v)}
                >
                  {showQuickPmForm ? '✕ Fechar' : '+ Novo meio'}
                </button>
              </div>

              {quickPmError && (
                <span className="field-error" role="alert">
                  {quickPmError}
                </span>
              )}

              {showQuickPmForm && (
                <div
                  className="panel"
                  style={{
                    marginTop: '0.5rem',
                    marginBottom: 0,
                    padding: '0.75rem',
                    background: 'var(--surface-2)',
                  }}
                >
                  <div className="form-grid form-grid-2">
                    <div className="field">
                      <label htmlFor="quick-pm-name">Nome / Apelido</label>
                      <input
                        id="quick-pm-name"
                        type="text"
                        maxLength={60}
                        placeholder="Ex.: PIX Itaú, Cartão Nubank"
                        value={quickPmName}
                        onChange={(e) => setQuickPmName(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="quick-pm-kind">Tipo</label>
                      <SelectField
                        id="quick-pm-kind"
                        value={quickPmKind}
                        onChange={(e) => setQuickPmKind(e.target.value as PaymentKind)}
                      >
                        {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                          <option key={k} value={k}>
                            {PAYMENT_KIND_LABELS[k]}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                  </div>
                  <div className="user-bar" style={{ marginTop: '0.6rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={quickPmBusy}
                      onClick={handleCreateQuickPm}
                    >
                      {quickPmBusy ? 'Criando…' : 'Salvar e usar'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: '0.85rem' }}>
              <label htmlFor="sheet-exp-notes">Observação (opcional)</label>
              <input
                id="sheet-exp-notes"
                type="text"
                maxLength={500}
                placeholder="Detalhes adicionais"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Opções avançadas: Parcelamento 2x..48x, Quem pagou e Estratégia de Divisão */}
            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((v) => !v)}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <span>
                  {showAdvanced ? '▾' : '▸'} Opções de parcelamento, pagador e divisão
                </span>
                <span className="badge badge-neutral">
                  {!editingExpense && totalInstallments > 1 ? `${totalInstallments}x · ` : ''}
                  {isCollective ? SPLIT_STRATEGY_LABELS[splitStrategy] : 'Individual'}
                </span>
              </button>

              {showAdvanced && (
                <div
                  className="panel"
                  style={{ marginTop: '0.65rem', marginBottom: 0, background: 'var(--surface-2)' }}
                >
                  <div className="form-grid form-grid-2">
                    {!editingExpense && (
                      <div className="field">
                        <label htmlFor="sheet-exp-installments">Parcelas (1x a 48x)</label>
                        <input
                          id="sheet-exp-installments"
                          type="number"
                          min={1}
                          max={48}
                          required
                          value={totalInstallments}
                          onChange={(e) =>
                            setTotalInstallments(
                              Math.max(1, Math.min(48, Number(e.target.value) || 1)),
                            )
                          }
                        />
                        {installmentsError && (
                          <span className="field-error" role="alert">
                            {installmentsError}
                          </span>
                        )}
                      </div>
                    )}

                    {isCollective && household && (
                      <div className="field">
                        <label htmlFor="sheet-exp-paidby">Pago por</label>
                        <SelectField
                          id="sheet-exp-paidby"
                          value={paidByUserId}
                          onChange={(e) => setPaidByUserId(e.target.value)}
                        >
                          {household.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} {m.id === user.id ? '(você)' : ''}
                            </option>
                          ))}
                        </SelectField>
                      </div>
                    )}
                  </div>

                  {isCollective && household && (
                    <div style={{ marginTop: '0.85rem' }}>
                      <div className="field">
                        <label htmlFor="sheet-exp-split">Divisão entre familiares</label>
                        <SelectField
                          id="sheet-exp-split"
                          value={splitStrategy}
                          onChange={(e) => setSplitStrategy(e.target.value as SplitStrategy)}
                        >
                          {(Object.keys(SPLIT_STRATEGY_LABELS) as SplitStrategy[]).map((s) => (
                            <option key={s} value={s}>
                              {SPLIT_STRATEGY_LABELS[s]}
                            </option>
                          ))}
                        </SelectField>
                      </div>

                      <div className="form-grid form-grid-2" style={{ marginTop: '0.65rem' }}>
                        {household.members.map((m) => {
                          const checked = selectedParticipants[m.id] !== false;
                          return (
                            <div
                              key={m.id}
                              className="expense-item"
                              style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-1)' }}
                            >
                              <label className="field-checkbox" style={{ minHeight: '2.25rem' }}>
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

                              {checked && splitStrategy === 'exact' && (
                                <MoneyInput
                                  variant="compact"
                                  ariaLabel={`Valor exato de ${m.name}`}
                                  value={splitCustomValues[m.id] ?? ''}
                                  onChange={(val) =>
                                    setSplitCustomValues((prev) => ({
                                      ...prev,
                                      [m.id]: val,
                                    }))
                                  }
                                />
                              )}

                              {checked && splitStrategy !== 'equal' && splitStrategy !== 'exact' && (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`Peso ou porcentagem de ${m.name}`}
                                  placeholder={splitStrategy === 'percentage' ? '50%' : '1'}
                                  style={{
                                    width: '6.2rem',
                                    minHeight: '2.25rem',
                                    padding: '0.3rem 0.55rem',
                                  }}
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

                      {splitInlineError && (
                        <span className="field-error" role="alert" style={{ marginTop: '0.45rem' }}>
                          {splitInlineError}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="sheet-footer">
            <button type="button" className="btn btn-outline btn-pill" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-pill"
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {submitting
                ? 'Salvando…'
                : editingExpense
                  ? 'Salvar alterações'
                  : totalInstallments > 1
                    ? `Adicionar em ${totalInstallments}x`
                    : 'Adicionar despesa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
