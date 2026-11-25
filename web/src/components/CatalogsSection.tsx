import React, { useState } from 'react';
import {
  api,
  ApiError,
  Category,
  Household,
  PaymentKind,
  PaymentMethod,
  User,
} from '../api';
import { CategoryIconBadge } from './CategoryIconBadge';
import { SelectField } from './ui/SelectField';

const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  debit: 'Cartão de Débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  other: 'Outro',
};

interface CatalogsSectionProps {
  user: User;
  household: Household | null;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  onCategoryCreated: (cat: Category) => void;
  onPaymentMethodCreated: (pm: PaymentMethod) => void;
  onError: (msg: string | null) => void;
}

export function CatalogsSection({
  user,
  household,
  categories,
  paymentMethods,
  onCategoryCreated,
  onPaymentMethodCreated,
  onError,
}: CatalogsSectionProps) {
  const [newCatName, setNewCatName] = useState('');
  const [catTouched, setCatTouched] = useState(false);

  const [newPmName, setNewPmName] = useState('');
  const [pmNameTouched, setPmNameTouched] = useState(false);
  const [newPmKind, setNewPmKind] = useState<PaymentKind>('pix');
  const [newPmLast4, setNewPmLast4] = useState('');
  const [newPmClosingDay, setNewPmClosingDay] = useState('');
  const [newPmDueDay, setNewPmDueDay] = useState('');
  const [newPmPersonal, setNewPmPersonal] = useState(false);

  const catNameError =
    catTouched && !newCatName.trim() ? 'Informe o nome da categoria.' : null;
  const pmNameError =
    pmNameTouched && !newPmName.trim() ? 'Informe o nome ou apelido do meio de pagamento.' : null;

  const isCard = newPmKind === 'credit_card' || newPmKind === 'debit';
  const last4Trimmed = newPmLast4.trim();
  const last4Error =
    isCard && last4Trimmed && !/^\d{4}$/.test(last4Trimmed)
      ? 'Informe exatamente 4 dígitos numéricos (ex.: 1234).'
      : null;

  const closingDayNum = newPmClosingDay.trim() ? Number(newPmClosingDay.trim()) : null;
  const closingDayError =
    newPmKind === 'credit_card' &&
    closingDayNum !== null &&
    (!Number.isInteger(closingDayNum) || closingDayNum < 1 || closingDayNum > 31)
      ? 'O dia de fechamento deve estar entre 1 e 31.'
      : null;

  const dueDayNum = newPmDueDay.trim() ? Number(newPmDueDay.trim()) : null;
  const dueDayError =
    newPmKind === 'credit_card' &&
    dueDayNum !== null &&
    (!Number.isInteger(dueDayNum) || dueDayNum < 1 || dueDayNum > 31)
      ? 'O dia de vencimento deve estar entre 1 e 31.'
      : null;

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setCatTouched(true);
    if (!newCatName.trim()) return;
    try {
      const created = await api.createCategory(newCatName.trim());
      onCategoryCreated(created);
      setNewCatName('');
      setCatTouched(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar categoria');
    }
  }

  async function handleCreatePaymentMethod(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setPmNameTouched(true);
    if (!newPmName.trim()) return;
    if (last4Error || closingDayError || dueDayError) {
      onError(last4Error || closingDayError || dueDayError);
      return;
    }

    try {
      const created = await api.createPaymentMethod({
        name: newPmName.trim(),
        kind: newPmKind,
        last4: isCard && last4Trimmed ? last4Trimmed : undefined,
        closing_day: newPmKind === 'credit_card' && closingDayNum !== null ? closingDayNum : undefined,
        due_day: newPmKind === 'credit_card' && dueDayNum !== null ? dueDayNum : undefined,
        is_personal: newPmPersonal,
      });
      onPaymentMethodCreated(created);
      setNewPmName('');
      setPmNameTouched(false);
      setNewPmLast4('');
      setNewPmClosingDay('');
      setNewPmDueDay('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar meio de pagamento');
    }
  }

  return (
    <div>
      <section className="panel" aria-label="Categorias e Meios de Pagamento">
        <div className="form-grid form-grid-2">
          <div>
            <h3>Categorias</h3>
            <form className="form-stack" onSubmit={handleCreateCategory}>
              <div className="field">
                <label htmlFor="new-cat-name">Nova categoria</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <CategoryIconBadge name={newCatName || 'Nova'} />
                  <input
                    id="new-cat-name"
                    className={catNameError ? 'input-invalid' : ''}
                    type="text"
                    required
                    maxLength={60}
                    placeholder="Ex.: Pet, Assinaturas, Farmácia"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onBlur={() => setCatTouched(true)}
                    style={{ flex: 1 }}
                  />
                </div>
                {catNameError && (
                  <span className="field-error" role="alert">
                    {catNameError}
                  </span>
                )}
              </div>
              <button type="submit" className="btn btn-primary">
                Adicionar categoria
              </button>
            </form>
            <ul className="member-list" aria-label="Categorias cadastradas">
              {categories.map((c) => (
                <li key={c.id} className="member-chip">
                  <CategoryIconBadge name={c.name} categoryId={c.id} />
                  <span>{c.name}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3>Meios de Pagamento</h3>
            <form className="form-stack" onSubmit={handleCreatePaymentMethod}>
              <div className="field">
                <label htmlFor="new-pm-name">Nome / Apelido</label>
                <input
                  id="new-pm-name"
                  className={pmNameError ? 'input-invalid' : ''}
                  type="text"
                  required
                  maxLength={60}
                  placeholder="Ex.: Cartão Nubank, PIX Casa"
                  value={newPmName}
                  onChange={(e) => setNewPmName(e.target.value)}
                  onBlur={() => setPmNameTouched(true)}
                />
                {pmNameError && (
                  <span className="field-error" role="alert">
                    {pmNameError}
                  </span>
                )}
              </div>
              <div className="form-grid form-grid-2">
                <div className="field">
                  <label htmlFor="new-pm-kind">Tipo</label>
                  <SelectField
                    id="new-pm-kind"
                    value={newPmKind}
                    onChange={(e) => setNewPmKind(e.target.value as PaymentKind)}
                  >
                    {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {PAYMENT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </SelectField>
                </div>
                {isCard && (
                  <div className="field">
                    <label htmlFor="new-pm-last4">4 últimos dígitos (opc.)</label>
                    <input
                      id="new-pm-last4"
                      className={last4Error ? 'input-invalid' : ''}
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="1234"
                      value={newPmLast4}
                      onChange={(e) => setNewPmLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                    {last4Error && (
                      <span className="field-error" role="alert">
                        {last4Error}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {newPmKind === 'credit_card' && (
                <div className="form-grid form-grid-2">
                  <div className="field">
                    <label htmlFor="new-pm-closing">Fechamento (1–31, opc.)</label>
                    <input
                      id="new-pm-closing"
                      className={closingDayError ? 'input-invalid' : ''}
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Ex.: 25"
                      value={newPmClosingDay}
                      onChange={(e) => setNewPmClosingDay(e.target.value)}
                    />
                    {closingDayError && (
                      <span className="field-error" role="alert">
                        {closingDayError}
                      </span>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="new-pm-due">Vencimento (1–31, opc.)</label>
                    <input
                      id="new-pm-due"
                      className={dueDayError ? 'input-invalid' : ''}
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Ex.: 5"
                      value={newPmDueDay}
                      onChange={(e) => setNewPmDueDay(e.target.value)}
                    />
                    {dueDayError && (
                      <span className="field-error" role="alert">
                        {dueDayError}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={newPmPersonal}
                  onChange={(e) => setNewPmPersonal(e.target.checked)}
                />
                <span>Meio pessoal (visível somente para mim)</span>
              </label>
              <button type="submit" className="btn btn-primary">
                Adicionar meio de pagamento
              </button>
            </form>
            <ul className="member-list" aria-label="Meios de pagamento cadastrados">
              {paymentMethods.map((pm) => (
                <li key={pm.id} className="member-chip">
                  {pm.name} ({PAYMENT_KIND_LABELS[pm.kind]}
                  {pm.last4 ? ` •••• ${pm.last4}` : ''}
                  {pm.closing_day ? ` · fecha dia ${pm.closing_day}` : ''}
                  {pm.due_day ? ` · vence dia ${pm.due_day}` : ''})
                  {pm.is_personal ? ' · Pessoal' : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {household && (
        <section className="panel" aria-labelledby="members-heading">
          <h3 id="members-heading">Membros da residência ({household.members.length})</h3>
          <ul className="member-list">
            {household.members.map((m) => (
              <li key={m.id} className="member-chip">
                {m.name} {m.id === user.id ? '(você)' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
