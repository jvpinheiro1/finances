import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AndroidDevice,
  api,
  ApiError,
  AppNotification,
  BalanceSummary,
  BankImportItem,
  Category,
  centsToInput,
  Expense,
  formatCentsBRL,
  Household,
  PairDebt,
  parseBRLToCents,
  parsePercentToBps,
  PaymentKind,
  PaymentMethod,
  RecurringFrequency,
  RecurringRule,
  ReportSummary,
  Settlement,
  SettlementStatus,
  SplitInput,
  SplitStrategy,
  User,
  Workspace,
} from './api';

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

const SPLIT_STRATEGY_LABELS: Record<SplitStrategy, string> = {
  equal: 'Partes iguais entre os participantes marcados',
  exact: 'Valor exato em R$ por participante',
  percentage: 'Porcentagem (%) por participante',
  shares: 'Cotas / Pesos (ex.: 2 e 1)',
};

const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: 'Aguardando confirmação do recebedor',
  confirmed: 'Confirmado',
  rejected: 'Recusado / Cancelado',
};

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 15h6M9 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="layout-center" aria-busy="true">
        <p>Carregando…</p>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen onLoggedIn={setUser} />;
  }

  if (user.must_change_password) {
    return (
      <ChangePasswordScreen
        user={user}
        onPasswordChanged={() => setUser({ ...user, must_change_password: false })}
        onLogout={() => setUser(null)}
      />
    );
  }

  return <DashboardScreen user={user} onLogout={() => setUser(null)} />;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u = await api.login(email, password);
      onLoggedIn(u);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="layout-center">
      <section className="card" aria-labelledby="login-title">
        <div className="brand-header">
          <span className="brand-icon">
            <HomeIcon />
          </span>
          <div>
            <h1 id="login-title">Finanças Família</h1>
            <p className="subtitle">Acesso restrito aos membros da casa</p>
          </div>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert-error" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ChangePasswordScreen({
  user,
  onPasswordChanged,
  onLogout,
}: {
  user: User;
  onPasswordChanged: () => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 12) {
      setError('A nova senha deve ter pelo menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação da nova senha não confere.');
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      onPasswordChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar a senha');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <main className="layout-center">
      <section className="card" aria-labelledby="pwd-title">
        <h1 id="pwd-title">Troca obrigatória de senha</h1>
        <p className="subtitle">
          Olá, <strong>{user.name}</strong>. Para sua segurança, substitua a senha temporária por
          uma senha pessoal antes de continuar.
        </p>

        <form className="form-stack" onSubmit={handleSubmit}>
          {error && (
            <div className="alert-error" role="alert">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="current-password">Senha temporária (atual)</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="new-password">Nova senha</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p className="field-hint">Mínimo de 12 caracteres.</p>
          </div>

          <div className="field">
            <label htmlFor="confirm-password">Confirmar nova senha</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Salvando…' : 'Definir senha definitiva'}
          </button>
          <button type="button" className="btn btn-outline" onClick={handleLogout}>
            Sair
          </button>
        </form>
      </section>
    </main>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function DashboardScreen({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWsId, setActiveWsId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalCents, setTotalCents] = useState<number>(0);
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [filterCatId, setFilterCatId] = useState<string>('');

  const [balances, setBalances] = useState<BalanceSummary | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [showRecurring, setShowRecurring] = useState<boolean>(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);
  const [showReports, setShowReports] = useState<boolean>(false);

  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [bankImports, setBankImports] = useState<BankImportItem[]>([]);
  const [showAndroidImports, setShowAndroidImports] = useState<boolean>(false);
  const [importAmountOverrides, setImportAmountOverrides] = useState<Record<string, string>>({});
  const [importTargetWs, setImportTargetWs] = useState<Record<string, string>>({});
  const prevUnreadRef = useRef<number>(0);

  // Campos de nova recorrência / assinatura
  const [recDesc, setRecDesc] = useState('');
  const [recAmountInput, setRecAmountInput] = useState('');
  const [recFreq, setRecFreq] = useState<RecurringFrequency>('monthly');
  const [recStartDate, setRecStartDate] = useState(todayISO());
  const [recNotes, setRecNotes] = useState('');

  const [showCatalogs, setShowCatalogs] = useState<boolean>(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Campos do formulário de despesa
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [incurredOn, setIncurredOn] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paidByUserId, setPaidByUserId] = useState(user.id);
  const [totalInstallments, setTotalInstallments] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [splitStrategy, setSplitStrategy] = useState<SplitStrategy>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>({});
  const [splitCustomValues, setSplitCustomValues] = useState<Record<string, string>>({});

  // Estorno inline
  const [refundingExpense, setRefundingExpense] = useState<Expense | null>(null);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundDate, setRefundDate] = useState(todayISO());
  const [refundReason, setRefundReason] = useState('');

  // Campos de reembolso
  const [stFromUserId, setStFromUserId] = useState(user.id);
  const [stToUserId, setStToUserId] = useState('');
  const [stAmountInput, setStAmountInput] = useState('');
  const [stPaidOn, setStPaidOn] = useState(todayISO());
  const [stNotes, setStNotes] = useState('');

  // Campos de criação rápida de categoria / meio de pagamento
  const [newCatName, setNewCatName] = useState('');
  const [newPmName, setNewPmName] = useState('');
  const [newPmKind, setNewPmKind] = useState<PaymentKind>('pix');
  const [newPmLast4, setNewPmLast4] = useState('');
  const [newPmClosingDay, setNewPmClosingDay] = useState('');
  const [newPmDueDay, setNewPmDueDay] = useState('');
  const [newPmPersonal, setNewPmPersonal] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const initParticipants = useCallback((hh: Household | null) => {
    if (!hh) return;
    const map: Record<string, boolean> = {};
    for (const m of hh.members) {
      map[m.id] = true;
    }
    setSelectedParticipants(map);
    setSplitCustomValues({});
  }, []);

  const loadAndroidImports = useCallback(async () => {
    try {
      const [devs, imps] = await Promise.all([api.listDevices(), api.listImports('pending')]);
      setDevices(devs.items);
      setBankImports(imps.items);
    } catch {
      // ignora
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.listNotifications(false);
      setNotifications(res.items);
      setUnreadCount(res.unread_count);
      if (
        res.unread_count > prevUnreadRef.current &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        // E6-D1 / ADR 0009: nunca expõe valores financeiros nem descrições privadas no banner do SO.
        new Notification('Finanças Família', {
          body: 'Você tem uma nova atualização na sua caixa de entrada.',
          icon: '/icon.svg',
        });
      }
      prevUnreadRef.current = res.unread_count;
    } catch {
      // ignora falha transitória de polling
    }
  }, []);

  const loadCollectiveBalances = useCallback(async () => {
    try {
      const [bal, stl] = await Promise.all([api.getBalances(), api.listSettlements()]);
      setBalances(bal);
      setSettlements(stl.items);
      await loadNotifications();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao atualizar saldos da família');
    }
  }, [loadNotifications]);

  const loadExpenses = useCallback(
    async (wsId: string, from: string, to: string, catId: string) => {
      if (!wsId) return;
      try {
        const [res, rules, rep] = await Promise.all([
          api.listExpenses(wsId, {
            from: from || undefined,
            to: to || undefined,
            category_id: catId || undefined,
          }),
          api.listRecurringRules(wsId),
          api.getReportSummary(wsId, from || undefined, to || undefined),
        ]);
        setExpenses(res.items);
        setTotalCents(res.total_cents);
        setRecurringRules(rules.items);
        setReportSummary(rep);
        await Promise.all([loadNotifications(), loadAndroidImports()]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erro ao listar despesas');
      }
    },
    [loadNotifications, loadAndroidImports],
  );

  useEffect(() => {
    Promise.all([
      api.getHousehold(),
      api.listWorkspaces(),
      api.listCategories(),
      api.listPaymentMethods(),
      api.getBalances(),
      api.listSettlements(),
    ])
      .then(([hh, ws, cats, pms, bal, stl]) => {
        setHousehold(hh);
        initParticipants(hh);
        const other = hh.members.find((m) => m.id !== user.id);
        if (other) {
          setStToUserId(other.id);
        } else if (hh.members[0]) {
          setStToUserId(hh.members[0].id);
        }
        setWorkspaces(ws.items);
        setCategories(cats.items);
        setPaymentMethods(pms.items);
        setBalances(bal);
        setSettlements(stl.items);
        if (cats.items.length > 0) {
          setCategoryId(cats.items[0].id);
        }
        if (ws.items.length > 0) {
          setActiveWsId(ws.items[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Erro ao carregar dados iniciais');
      });
  }, [initParticipants, user.id]);

  useEffect(() => {
    if (activeWsId) {
      void loadExpenses(activeWsId, filterFrom, filterTo, filterCatId);
    }
  }, [activeWsId, filterFrom, filterTo, filterCatId, loadExpenses]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWsId);
  const isCollective = activeWorkspace?.kind === 'household';

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
    initParticipants(household);
  }

  function startEditExpense(exp: Expense) {
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
      initParticipants(household);
    }
  }

  function buildSplitsInput(): SplitInput[] | null {
    if (!isCollective || !household) return [];
    const activeIds = household.members
      .filter((m) => selectedParticipants[m.id])
      .map((m) => m.id);
    if (activeIds.length === 0) {
      setError('Selecione pelo menos 1 familiar participante na divisão.');
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
          setError('Informe um valor válido em R$ para cada participante selecionado.');
          return null;
        }
        out.push({ user_id: id, share_cents: cents });
      } else if (splitStrategy === 'percentage') {
        const bps = parsePercentToBps(raw);
        if (bps === null) {
          setError('Informe uma porcentagem válida para cada participante (soma deve ser 100%).');
          return null;
        }
        out.push({ user_id: id, weight_bps: bps });
      } else if (splitStrategy === 'shares') {
        const w = parseInt(raw.trim(), 10);
        if (!Number.isInteger(w) || w <= 0) {
          setError('Informe um número inteiro positivo de cotas para cada participante.');
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
    setError(null);
    const cents = parseBRLToCents(amountInput);
    if (cents === null) {
      setError('Informe um valor válido em reais (ex.: 45,90).');
      return;
    }
    const splits = buildSplitsInput();
    if (splits === null) return;

    setSubmitting(true);
    try {
      const payload = {
        category_id: categoryId,
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
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar despesa');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteExpense(exp: Expense) {
    setError(null);
    try {
      await api.deleteExpense(exp.id);
      if (editingExpense?.id === exp.id) {
        resetExpenseForm();
      }
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao excluir despesa');
    }
  }

  async function handleDeleteInstallmentPlan(planId: string) {
    setError(null);
    try {
      await api.deleteInstallmentPlan(planId);
      resetExpenseForm();
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao excluir parcelamento completo');
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
    setError(null);
    const cents = parseBRLToCents(refundAmountInput);
    if (cents === null) {
      setError('Informe um valor válido em reais para o estorno.');
      return;
    }
    try {
      await api.createRefund(refundingExpense.id, {
        amount_cents: cents,
        refunded_on: refundDate,
        reason: refundReason,
      });
      setRefundingExpense(null);
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao registrar estorno');
    }
  }

  async function handleShareExpense(exp: Expense) {
    setError(null);
    try {
      await api.shareExpenseWithHousehold(exp.id);
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao compartilhar despesa com a casa');
    }
  }

  async function handleCreateRecurring(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWsId) return;
    setError(null);
    const cents = parseBRLToCents(recAmountInput);
    if (cents === null) {
      setError('Informe um valor válido em reais para a assinatura ou conta recorrente.');
      return;
    }
    try {
      await api.createRecurringRule(activeWsId, {
        category_id: categoryId,
        payment_method_id: paymentMethodId ? paymentMethodId : null,
        paid_by_user_id: isCollective ? paidByUserId : user.id,
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
      await loadExpenses(activeWsId, filterFrom, filterTo, filterCatId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar recorrência');
    }
  }

  async function handleToggleRecurring(rule: RecurringRule) {
    setError(null);
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
      await loadExpenses(activeWsId, filterFrom, filterTo, filterCatId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao atualizar recorrência');
    }
  }

  async function handleDeleteRecurring(id: string) {
    setError(null);
    try {
      await api.deleteRecurringRule(id);
      await loadExpenses(activeWsId, filterFrom, filterTo, filterCatId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao excluir recorrência');
    }
  }

  async function handleGenerateRecurring() {
    if (!activeWsId) return;
    setError(null);
    try {
      await api.generateRecurringRules(activeWsId);
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao gerar recorrências do mês');
    }
  }

  async function handleMarkNotificationRead(id: string) {
    try {
      await api.markNotificationRead(id);
      await loadNotifications();
    } catch {
      // ignora
    }
  }

  async function handleMarkAllNotificationsRead() {
    try {
      await api.markAllNotificationsRead();
      await loadNotifications();
    } catch {
      // ignora
    }
  }

  async function handleEnableBrowserNotifications() {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      await Notification.requestPermission();
    }
  }

  async function handleCreateDevice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createDevice(newDeviceName);
      setGeneratedToken(res.plain_token);
      setNewDeviceName('');
      await loadAndroidImports();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar token de dispositivo');
    }
  }

  async function handleRevokeDevice(id: string) {
    setError(null);
    try {
      await api.revokeDevice(id);
      await loadAndroidImports();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao revogar dispositivo');
    }
  }

  async function handleApproveImport(item: BankImportItem) {
    setError(null);
    const personalWs = workspaces.find((w) => w.kind === 'personal');
    const targetWsId = importTargetWs[item.id] || personalWs?.id || activeWsId;
    let overrideCents: number | undefined;
    if (item.parse_status === 'needs_review' || importAmountOverrides[item.id]) {
      const parsed = parseBRLToCents(importAmountOverrides[item.id] ?? '');
      if (parsed === null) {
        setError('Informe o valor em R$ para aprovar este item da fila.');
        return;
      }
      overrideCents = parsed;
    }
    try {
      await api.approveImport(item.id, {
        workspace_id: targetWsId,
        category_id: categoryId,
        amount_cents: overrideCents,
        total_installments: item.parsed_installments,
      });
      await Promise.all([
        loadExpenses(activeWsId, filterFrom, filterTo, filterCatId),
        loadCollectiveBalances(),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao aprovar notificação bancária');
    }
  }

  async function handleDiscardImport(id: string) {
    setError(null);
    try {
      await api.discardImport(id);
      await loadAndroidImports();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao descartar notificação bancária');
    }
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
    setError(null);
    const cents = parseBRLToCents(stAmountInput);
    if (cents === null) {
      setError('Informe um valor válido em reais para o reembolso.');
      return;
    }
    try {
      await api.createSettlement({
        from_user_id: stFromUserId,
        to_user_id: stToUserId,
        amount_cents: cents,
        paid_on: stPaidOn,
        notes: stNotes,
      });
      setStAmountInput('');
      setStNotes('');
      await loadCollectiveBalances();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao registrar reembolso');
    }
  }

  async function handleConfirmSettlement(id: string) {
    setError(null);
    try {
      await api.confirmSettlement(id);
      await loadCollectiveBalances();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao confirmar reembolso');
    }
  }

  async function handleRejectSettlement(id: string) {
    setError(null);
    try {
      await api.rejectSettlement(id);
      await loadCollectiveBalances();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao recusar reembolso');
    }
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.createCategory(newCatName);
      setCategories((prev) => [...prev, created]);
      if (!categoryId) setCategoryId(created.id);
      setNewCatName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar categoria');
    }
  }

  async function handleCreatePaymentMethod(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      setPaymentMethods((prev) => [...prev, created]);
      setNewPmName('');
      setNewPmLast4('');
      setNewPmClosingDay('');
      setNewPmDueDay('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar meio de pagamento');
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-header" style={{ marginBottom: 0 }}>
          <span className="brand-icon">
            <HomeIcon />
          </span>
          <div>
            <h1>{household ? household.name : 'Finanças Família'}</h1>
            <p className="subtitle">Logado como {user.name}</p>
          </div>
        </div>
        <div className="user-bar">
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showNotifications}
            onClick={() => setShowNotifications((v) => !v)}
          >
            Notificações{' '}
            {unreadCount > 0 && (
              <span className="badge badge-private" aria-label={`${unreadCount} não lidas`}>
                {unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showAndroidImports}
            onClick={() => setShowAndroidImports((v) => !v)}
          >
            Android / Importar{' '}
            {bankImports.length > 0 && (
              <span className="badge badge-private">{bankImports.length}</span>
            )}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showReports}
            onClick={() => setShowReports((v) => !v)}
          >
            {showReports ? 'Fechar Relatórios' : 'Relatórios (CSV / PDF)'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showRecurring}
            onClick={() => setShowRecurring((v) => !v)}
          >
            {showRecurring
              ? 'Fechar Recorrentes e Assinaturas'
              : `Recorrentes e Assinaturas (${recurringRules.length})`}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showCatalogs}
            onClick={() => setShowCatalogs((v) => !v)}
          >
            {showCatalogs ? 'Fechar Categorias e Meios' : 'Categorias e Meios de Pagamento'}
          </button>
          <button type="button" className="btn btn-outline" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main>
        {error && (
          <div className="alert-error" role="alert" style={{ marginTop: '1rem' }}>
            {error}
          </div>
        )}

        {showNotifications && (
          <section className="panel" aria-labelledby="notifications-title" style={{ marginTop: '1rem' }}>
            <div className="summary-bar">
              <div>
                <h2 id="notifications-title">
                  Minha Caixa de Entrada ({unreadCount} não {unreadCount === 1 ? 'lida' : 'lidas'})
                </h2>
                <p className="subtitle">
                  Notificações privadas da sua conta (protegidas por RLS individual no banco).
                </p>
              </div>
              <div className="user-bar">
                {typeof window !== 'undefined' &&
                  'Notification' in window &&
                  Notification.permission === 'default' && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={handleEnableBrowserNotifications}
                    >
                      Ativar alerta discreto no navegador
                    </button>
                  )}
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleMarkAllNotificationsRead}
                  >
                    Marcar todas como lidas
                  </button>
                )}
              </div>
            </div>

            {notifications.length === 0 ? (
              <p className="subtitle" style={{ marginTop: '0.75rem' }}>
                Nenhuma notificação até o momento.
              </p>
            ) : (
              <ul className="expense-list" style={{ marginTop: '1rem' }}>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className="expense-item"
                    style={{
                      padding: '0.85rem 1rem',
                      opacity: n.is_read ? 0.72 : 1,
                    }}
                  >
                    <div className="expense-main">
                      <div className="expense-title">
                        <span>{n.title}</span>
                        {!n.is_read && <span className="badge badge-private">Nova</span>}
                      </div>
                      <div className="expense-meta">
                        <span>{n.body}</span>
                      </div>
                    </div>
                    {!n.is_read && (
                      <div className="expense-right">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => handleMarkNotificationRead(n.id)}
                        >
                          Marcar como lida
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-label="Seletor de ambiente" className="workspace-switcher">
          {workspaces.map((ws) => {
            const collective = ws.kind === 'household';
            const selected = ws.id === activeWsId;
            return (
              <button
                key={ws.id}
                type="button"
                className="ws-tab"
                aria-pressed={selected}
                onClick={() => {
                  setActiveWsId(ws.id);
                  resetExpenseForm();
                }}
              >
                <span className="ws-tab-title">
                  {collective ? 'Espaço da Família' : 'Meu Espaço Individual'}
                  <span className={`badge ${collective ? '' : 'badge-private'}`}>
                    {collective ? 'Coletivo' : 'Privado'}
                  </span>
                </span>
                <span className="subtitle">
                  {collective
                    ? 'Despesas compartilhadas, divisões, parcelamentos e acerto de contas.'
                    : 'Seus gastos pessoais privados (nunca entram no saldo coletivo).'}
                </span>
              </button>
            );
          })}
        </section>

        {showAndroidImports && (
          <section className="panel" aria-labelledby="android-imports-title">
            <h2 id="android-imports-title">
              App Android & Fila Privada de Notificações Bancárias ({bankImports.length} pendentes)
            </h2>
            <p className="subtitle">
              Suporta Nubank, Itaú, Bradesco, Banco do Brasil, Inter, Santander e C6 Bank. Apenas
              você enxerga as notificações capturadas no seu celular (protegidas por RLS).
            </p>

            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
              <div>
                <h3>Parear Celular Android</h3>
                <form className="form-stack" onSubmit={handleCreateDevice}>
                  <div className="field">
                    <label htmlFor="dev-name">Nome do aparelho</label>
                    <input
                      id="dev-name"
                      type="text"
                      required
                      maxLength={80}
                      placeholder="Ex.: Samsung S24 / Pixel 8"
                      value={newDeviceName}
                      onChange={(e) => setNewDeviceName(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Gerar Token de Dispositivo
                  </button>
                </form>

                {generatedToken && (
                  <div
                    className="panel"
                    style={{ marginTop: '0.85rem', marginBottom: 0, wordBreak: 'break-all' }}
                  >
                    <strong>Token gerado (copie agora, exibido uma única vez):</strong>
                    <p style={{ fontFamily: 'monospace', margin: '0.4rem 0' }}>{generatedToken}</p>
                  </div>
                )}

                {devices.length > 0 && (
                  <ul className="expense-list" style={{ marginTop: '0.85rem' }}>
                    {devices.map((d) => (
                      <li key={d.id} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                        <div>
                          <strong>{d.device_name}</strong>{' '}
                          <span className={`badge ${d.revoked_at ? 'badge-neutral' : 'badge-private'}`}>
                            {d.revoked_at ? 'Revogado' : 'Ativo'}
                          </span>
                        </div>
                        {!d.revoked_at && (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleRevokeDevice(d.id)}
                          >
                            Revogar
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3>Fila de Revisão de Notificações Bancárias</h3>
                {bankImports.length === 0 ? (
                  <p className="subtitle">Nenhuma notificação pendente de revisão.</p>
                ) : (
                  <ul className="expense-list">
                    {bankImports.map((item) => {
                      const personalWs = workspaces.find((w) => w.kind === 'personal');
                      const selectedWs =
                        importTargetWs[item.id] || personalWs?.id || activeWsId;
                      return (
                        <li key={item.id} className="expense-item" style={{ padding: '0.85rem' }}>
                          <div className="expense-main">
                            <div className="expense-title">
                              <span>{item.merchant_or_title}</span>
                              <span className="badge badge-neutral">
                                {item.bank_code.toUpperCase()}
                              </span>
                              {item.parse_status === 'needs_review' && (
                                <span className="badge">Informar valor manual</span>
                              )}
                            </div>
                            <div className="expense-meta">
                              <span>Data: {item.occurred_on}</span>
                              {item.card_last4 && <span>· Cartão •••• {item.card_last4}</span>}
                              {item.parsed_installments > 1 && (
                                <span>· {item.parsed_installments}x</span>
                              )}
                            </div>

                            <div className="form-grid form-grid-2" style={{ marginTop: '0.5rem' }}>
                              <select
                                aria-label="Ambiente de destino"
                                value={selectedWs}
                                onChange={(e) =>
                                  setImportTargetWs((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                              >
                                {workspaces.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.kind === 'personal'
                                      ? 'Meu Espaço Individual (Privado)'
                                      : 'Espaço da Família (Coletivo)'}
                                  </option>
                                ))}
                              </select>

                              {item.parse_status === 'needs_review' ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Valor R$ 0,00"
                                  value={importAmountOverrides[item.id] ?? ''}
                                  onChange={(e) =>
                                    setImportAmountOverrides((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                <strong>
                                  {formatCentsBRL(item.parsed_amount_cents ?? 0)}
                                </strong>
                              )}
                            </div>
                          </div>

                          <div className="expense-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleApproveImport(item)}
                            >
                              Aprovar despesa
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDiscardImport(item.id)}
                            >
                              Descartar
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        {showReports && reportSummary && (
          <section className="panel" aria-labelledby="reports-title">
            <div className="summary-bar">
              <div>
                <h2 id="reports-title">
                  Relatório Financeiro — {isCollective ? 'Espaço da Família' : 'Meu Espaço Individual'}
                </h2>
                <p className="subtitle">
                  Período: {reportSummary.from_date} a {reportSummary.to_date} ·{' '}
                  {reportSummary.expense_count} lançamentos · Bruto:{' '}
                  {formatCentsBRL(reportSummary.total_gross_cents)} · Estornado:{' '}
                  {formatCentsBRL(reportSummary.total_refunded_cents)} · Líquido:{' '}
                  <strong>{formatCentsBRL(reportSummary.total_net_cents)}</strong>
                </p>
              </div>
              <div className="user-bar">
                <a
                  className="btn btn-outline btn-sm"
                  href={api.reportExportUrl(
                    activeWsId,
                    'csv',
                    filterFrom || undefined,
                    filterTo || undefined,
                  )}
                  download
                >
                  Baixar CSV (Excel)
                </a>
                <a
                  className="btn btn-primary btn-sm"
                  href={api.reportExportUrl(
                    activeWsId,
                    'pdf',
                    filterFrom || undefined,
                    filterTo || undefined,
                  )}
                  download
                >
                  Baixar PDF
                </a>
              </div>
            </div>

            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
              <div>
                <h3>Por Categoria</h3>
                {reportSummary.by_category.length === 0 ? (
                  <p className="subtitle">Sem dados no período.</p>
                ) : (
                  <ul className="expense-list">
                    {reportSummary.by_category.map((c) => (
                      <li key={c.category_id} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                        <div>
                          <strong>{c.category_name}</strong> ({c.expense_count})
                        </div>
                        <div className="expense-right">
                          <span className="badge badge-neutral">
                            {(c.share_bps / 100).toFixed(1).replace('.', ',')}%
                          </span>
                          <strong>{formatCentsBRL(c.total_net_cents)}</strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3>Por Meio de Pagamento</h3>
                {reportSummary.by_payment_method.length === 0 ? (
                  <p className="subtitle">Sem dados no período.</p>
                ) : (
                  <ul className="expense-list">
                    {reportSummary.by_payment_method.map((pm) => (
                      <li key={pm.label} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                        <div>
                          <strong>{pm.label}</strong> ({pm.expense_count})
                        </div>
                        <div className="expense-right">
                          <span className="badge badge-neutral">
                            {(pm.share_bps / 100).toFixed(1).replace('.', ',')}%
                          </span>
                          <strong>{formatCentsBRL(pm.total_net_cents)}</strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {isCollective && reportSummary.by_member.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3>Desembolsado vs Consumido na Divisão por Familiar</h3>
                <ul className="expense-list">
                  {reportSummary.by_member.map((m) => (
                    <li key={m.user_id} className="expense-item" style={{ padding: '0.65rem 0.9rem' }}>
                      <div>
                        <strong>{m.user_name}</strong>
                      </div>
                      <div className="expense-meta" style={{ fontSize: '0.9rem' }}>
                        <span>Pagou: {formatCentsBRL(m.paid_net_cents)}</span>
                        <span>· Consumiu: {formatCentsBRL(m.consumed_net_cents)}</span>
                        <span>
                          · Diferença do período:{' '}
                          <strong>{formatCentsBRL(m.delta_cents)}</strong>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {showRecurring && (
          <section className="panel" aria-labelledby="recurring-title">
            <div className="summary-bar">
              <div>
                <h2 id="recurring-title">
                  {isCollective
                    ? 'Contas Recorrentes e Assinaturas da Família (Coletivo)'
                    : 'Minhas Assinaturas e Contas Recorrentes (Individual)'}
                </h2>
                <p className="subtitle">
                  Cadastre assinaturas mensais/anuais (Netflix, Spotify, Internet, Academia) e
                  contas fixas ou variáveis (Aluguel, Luz, Água).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleGenerateRecurring}
              >
                Gerar recorrências do mês atual
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

              <div className="form-grid form-grid-2">
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

            {recurringRules.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3>Recorrências cadastradas neste ambiente</h3>
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
              </div>
            )}
          </section>
        )}

        {showCatalogs && (
          <section className="panel" aria-labelledby="catalogs-title">
            <h2 id="catalogs-title">Categorias e Meios de Pagamento</h2>
            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
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
        )}

        <section className="panel" aria-labelledby="form-exp-title">
          <h2 id="form-exp-title">
            {editingExpense
              ? 'Editar despesa / parcela'
              : isCollective
                ? 'Lançar despesa no Espaço da Família (Coletivo)'
                : 'Lançar despesa no Meu Espaço Individual (Privado)'}
          </h2>
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
                  value={categoryId}
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
                      Gera {totalInstallments} parcelas mensais (eventual resto de centavos fica na
                      1ª parcela).
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
                    const checked = Boolean(selectedParticipants[m.id]);
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
        </section>

        {isCollective && balances && household && (
          <section className="panel" aria-labelledby="balances-title">
            <h2 id="balances-title">Saldos e Reembolsos da Família</h2>
            <p className="subtitle">
              Calculado sobre as despesas do ambiente coletivo (descontando estornos) e reembolsos
              confirmados.
            </p>

            <div className="form-grid form-grid-2" style={{ marginTop: '1rem' }}>
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
                            Registrar pagamento
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <h3 style={{ marginTop: '1rem' }}>Posição líquida por membro</h3>
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
                        value={stToUserId}
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
                      Se você for quem pagou, o reembolso ficará aguardando confirmação de quem
                      recebeu. Se você for quem recebeu, já entra confirmado.
                    </p>
                  </div>

                  <button type="submit" className="btn btn-primary">
                    Registrar reembolso
                  </button>
                </form>
              </div>
            </div>

            {settlements.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
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
        )}

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
                {isCollective ? 'Despesas da Família' : 'Minhas Despesas Individuais'} (
                {expenses.length})
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
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="filter-to">Até (data final)</label>
              <input
                id="filter-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="filter-cat">Filtrar por categoria</label>
              <select
                id="filter-cat"
                value={filterCatId}
                onChange={(e) => setFilterCatId(e.target.value)}
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
                      {exp.shared_at && (
                        <span className="badge">Compartilhada com a casa</span>
                      )}
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
                            .map((s) => `${s.user_name ?? 'Membro'}: ${formatCentsBRL(s.share_cents)}`)
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
      </main>
    </div>
  );
}
