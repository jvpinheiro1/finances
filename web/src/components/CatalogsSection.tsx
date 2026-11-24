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
  const [newPmName, setNewPmName] = useState('');
  const [newPmKind, setNewPmKind] = useState<PaymentKind>('pix');
  const [newPmLast4, setNewPmLast4] = useState('');
  const [newPmClosingDay, setNewPmClosingDay] = useState('');
  const [newPmDueDay, setNewPmDueDay] = useState('');
  const [newPmPersonal, setNewPmPersonal] = useState(false);

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      const created = await api.createCategory(newCatName);
      onCategoryCreated(created);
      setNewCatName('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar categoria');
    }
  }

  async function handleCreatePaymentMethod(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    const cd =
      newPmKind === 'credit_card' && newPmClosingDay.trim()
        ? parseInt(newPmClosingDay.trim(), 10)
        : undefined;
    const dd =
      newPmKind === 'credit_card' && newPmDueDay.trim()
        ? parseInt(newPmDueDay.trim(), 10)
        : undefined;
    try {
      const created = await api.createPaymentMethod({
        name: newPmName,
        kind: newPmKind,
        last4:
          (newPmKind === 'credit_card' || newPmKind === 'debit') && newPmLast4.trim()
            ? newPmLast4.trim()
            : undefined,
        closing_day: cd,
        due_day: dd,
        is_personal: newPmPersonal,
      });
      onPaymentMethodCreated(created);
      setNewPmName('');
      setNewPmLast4('');
      setNewPmClosingDay('');
      setNewPmDueDay('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Erro ao criar meio de pagamento');
    }
  }

  return (
    <div>
      <section className="panel" aria-labelledby="catalogs-title">
        <h2 id="catalogs-title">Categorias e Meios de Pagamento</h2>
        <p className="subtitle">
          Gerencie as categorias da residência e seus cartões/contas (com dias de fechamento e
          vencimento para cálculo automático de faturas).
        </p>

        <div className="form-grid form-grid-2" style={{ marginTop: '1.25rem' }}>
          <div>
            <h3>Nova Categoria (compartilhada na casa)</h3>
            <form className="form-stack" onSubmit={handleCreateCategory}>
              <div className="field">
                <label htmlFor="new-cat-name">Nome da categoria</label>
                <input
                  id="new-cat-name"
                  type="text"
                  required
                  maxLength={60}
                  placeholder="Ex.: Pet, Assinaturas"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Adicionar categoria
              </button>
            </form>
            <ul className="member-list" aria-label="Categorias cadastradas">
              {categories.map((c) => (
                <li key={c.id} className="member-chip">
                  {c.name}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3>Novo Meio de Pagamento</h3>
            <form className="form-stack" onSubmit={handleCreatePaymentMethod}>
              <div className="field">
                <label htmlFor="new-pm-name">Nome / Apelido</label>
                <input
                  id="new-pm-name"
                  type="text"
                  required
                  maxLength={60}
                  placeholder="Ex.: Cartão Nubank, PIX Casa"
                  value={newPmName}
                  onChange={(e) => setNewPmName(e.target.value)}
                />
              </div>
              <div className="form-grid form-grid-2">
                <div className="field">
                  <label htmlFor="new-pm-kind">Tipo</label>
                  <select
                    id="new-pm-kind"
                    value={newPmKind}
                    onChange={(e) => setNewPmKind(e.target.value as PaymentKind)}
                  >
                    {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {PAYMENT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {(newPmKind === 'credit_card' || newPmKind === 'debit') && (
                  <div className="field">
                    <label htmlFor="new-pm-last4">4 últimos dígitos (opcional)</label>
                    <input
                      id="new-pm-last4"
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="1234"
                      value={newPmLast4}
                      onChange={(e) => setNewPmLast4(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {newPmKind === 'credit_card' && (
                <div className="form-grid form-grid-2">
                  <div className="field">
                    <label htmlFor="new-pm-closing">Dia de fechamento (1–31, opc.)</label>
                    <input
                      id="new-pm-closing"
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Ex.: 25"
                      value={newPmClosingDay}
                      onChange={(e) => setNewPmClosingDay(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="new-pm-due">Dia de vencimento (1–31, opc.)</label>
                    <input
                      id="new-pm-due"
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Ex.: 5"
                      value={newPmDueDay}
                      onChange={(e) => setNewPmDueDay(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={newPmPersonal}
                  onChange={(e) => setNewPmPersonal(e.target.checked)}
                />
                <span>Meio de pagamento pessoal (visível somente para mim)</span>
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
          <h2 id="members-heading">Membros ativos da residência ({household.members.length})</h2>
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
