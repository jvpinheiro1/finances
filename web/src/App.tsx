import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router';
import {
  AndroidDevice,
  api,
  ApiError,
  AppNotification,
  BalanceSummary,
  BankImportItem,
  Category,
  Expense,
  Household,
  PaymentMethod,
  RecurringRule,
  ReportSummary,
  Settlement,
  User,
  Workspace,
} from './api';
import { AndroidImportsSection } from './components/AndroidImportsSection';
import { CatalogsSection } from './components/CatalogsSection';
import { ExpenseDetailSheet } from './components/ExpenseDetailSheet';
import { ExpenseFormSheet } from './components/ExpenseFormSheet';
import { ExpensesSection } from './components/ExpensesSection';
import { HomeSection } from './components/HomeSection';
import { NotificationsSection } from './components/NotificationsSection';
import { RecurringSection } from './components/RecurringSection';
import { ReportsSection } from './components/ReportsSection';
import { SettlementsSection } from './components/SettlementsSection';
import { buildPeriodState, PeriodState } from './utils/period';

type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'ff_theme';
const HIDE_VALUES_STORAGE_KEY = 'ff_hide_values';

function loadInitialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignora
  }
  return 'dark';
}

function loadInitialHideValues(): boolean {
  try {
    return window.localStorage.getItem(HIDE_VALUES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const ROUTE_META: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Início',
    subtitle: 'Visão geral do período',
  },
  '/lancamentos': {
    title: 'Lançamentos',
    subtitle: 'Histórico, filtros e parcelamentos',
  },
  '/saldos': {
    title: 'Saldos & Reembolsos',
    subtitle: 'Acertos entre membros da casa',
  },
  '/recorrentes': {
    title: 'Recorrentes & Assinaturas',
    subtitle: 'Contas fixas e assinaturas periódicas',
  },
  '/relatorios': {
    title: 'Relatórios',
    subtitle: 'Exportação CSV e PDF',
  },
  '/android': {
    title: 'Captura Android',
    subtitle: 'Dispositivos e fila de notificações bancárias',
  },
  '/cadastros': {
    title: 'Cadastros',
    subtitle: 'Categorias, meios de pagamento e membros',
  },
  '/notificacoes': {
    title: 'Notificações',
    subtitle: 'Alertas e avisos da sua conta',
  },
};

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v16M5 8h14M7 8l-3 6h6L7 8zm10 0l-3 6h6l-3-6z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 19h16M7 16V10m5 6V6m5 10v-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="6"
        y="3"
        width="12"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path d="M10 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  if (off) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: ThemeMode }) {
  if (theme === 'dark') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.9" />
        <path
          d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(loadInitialTheme);
  const [hideValues, setHideValues] = useState<boolean>(loadInitialHideValues);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignora
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDE_VALUES_STORAGE_KEY, hideValues ? '1' : '0');
    } catch {
      // ignora
    }
  }, [hideValues]);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  function toggleHideValues() {
    setHideValues((prev) => !prev);
  }

  if (loading) {
    return (
      <main className="layout-center" aria-busy="true">
        <p>Carregando…</p>
      </main>
    );
  }

  if (!user) {
    return <LoginScreen onLoggedIn={setUser} theme={theme} onToggleTheme={toggleTheme} />;
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

  return (
    <DashboardShell
      user={user}
      onLogout={() => setUser(null)}
      theme={theme}
      onToggleTheme={toggleTheme}
      hideValues={hideValues}
      onToggleHideValues={toggleHideValues}
    />
  );
}

function LoginScreen({
  onLoggedIn,
  theme,
  onToggleTheme,
}: {
  onLoggedIn: (u: User) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
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
        <div
          className="brand-header"
          style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="brand-icon">
              <HomeIcon />
            </span>
            <div>
              <h1 id="login-title">Finanças Família</h1>
              <p className="subtitle">Acesso restrito aos membros da casa</p>
            </div>
          </div>

          <button
            type="button"
            className="icon-btn"
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            onClick={onToggleTheme}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert-error" role="alert">
              <span>{error}</span>
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

          <button type="submit" className="btn btn-primary btn-pill" disabled={submitting}>
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
              <span>{error}</span>
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

          <button type="submit" className="btn btn-primary btn-pill" disabled={submitting}>
            {submitting ? 'Salvando…' : 'Definir senha definitiva'}
          </button>
          <button type="button" className="btn btn-outline btn-pill" onClick={handleLogout}>
            Sair
          </button>
        </form>
      </section>
    </main>
  );
}

function DashboardShell({
  user,
  onLogout,
  theme,
  onToggleTheme,
  hideValues,
  onToggleHideValues,
}: {
  user: User;
  onLogout: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  hideValues: boolean;
  onToggleHideValues: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Período padrão: Mês corrente (DA-6 = A)
  const [period, setPeriod] = useState<PeriodState>(() => buildPeriodState('month'));
  const [filterCatId, setFilterCatId] = useState<string>(() => searchParams.get('cat') ?? '');

  // Sheets de Nova/Editar Despesa e Detalhe da Despesa
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  const [household, setHousehold] = useState<Household | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWsId, setActiveWsId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalCents, setTotalCents] = useState<number>(0);

  const [balances, setBalances] = useState<BalanceSummary | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);

  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [bankImports, setBankImports] = useState<BankImportItem[]>([]);
  const prevUnreadRef = useRef<number>(0);

  const [error, setError] = useState<string | null>(null);

  // Fecha o drawer mobile ao mudar de rota
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  // Sincroniza query param ?cat= caso exista
  useEffect(() => {
    const catFromUrl = searchParams.get('cat') ?? '';
    if (catFromUrl !== filterCatId) {
      setFilterCatId(catFromUrl);
    }
  }, [searchParams, filterCatId]);

  function handleCategoryFilterChange(catId: string) {
    setFilterCatId(catId);
    const nextParams = new URLSearchParams(searchParams);
    if (catId) {
      nextParams.set('cat', catId);
    } else {
      nextParams.delete('cat');
    }
    setSearchParams(nextParams, { replace: true });
  }

  function handleFilterCategoryFromHome(catId: string) {
    setFilterCatId(catId);
    navigate(`/lancamentos?cat=${encodeURIComponent(catId)}`);
  }

  const loadAndroidImports = useCallback(async () => {
    try {
      const [devs, imps] = await Promise.all([api.listDevices(), api.listImports('pending')]);
      setDevices(devs.items);
      setBankImports(imps.items);
    } catch {
      // ignora erro transitório
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
        // E6-D1 / ADR 0009: nunca expõe valores financeiros no banner do SO.
        new Notification('Finanças Família', {
          body: 'Você tem uma nova atualização na sua caixa de entrada.',
          icon: '/icon.svg',
        });
      }
      prevUnreadRef.current = res.unread_count;
    } catch {
      // ignora falha transitória
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

  const loadWorkspaceData = useCallback(
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
        setError(err instanceof ApiError ? err.message : 'Erro ao carregar dados do ambiente');
      }
    },
    [loadNotifications, loadAndroidImports],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadWorkspaceData(activeWsId, period.from, period.to, filterCatId),
      loadCollectiveBalances(),
    ]);
  }, [activeWsId, period.from, period.to, filterCatId, loadWorkspaceData, loadCollectiveBalances]);

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
        setWorkspaces(ws.items);
        setCategories(cats.items);
        setPaymentMethods(pms.items);
        setBalances(bal);
        setSettlements(stl.items);
        if (ws.items.length > 0) {
          setActiveWsId(ws.items[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Erro ao carregar dados iniciais');
      });
  }, []);

  useEffect(() => {
    if (activeWsId) {
      void loadWorkspaceData(activeWsId, period.from, period.to, filterCatId);
    }
  }, [activeWsId, period.from, period.to, filterCatId, loadWorkspaceData]);

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  function openNewExpenseSheet() {
    setEditingExpense(null);
    setExpenseFormOpen(true);
  }

  function openEditExpenseSheet(exp: Expense) {
    setEditingExpense(exp);
    setExpenseFormOpen(true);
  }

  const activeWorkspace = workspaces.find((w) => w.id === activeWsId);
  const isCollective = activeWorkspace?.kind === 'household';
  const activeRecurringCount = recurringRules.filter((r) => r.is_active).length;
  const pendingSettlementsCount = settlements.filter((s) => s.status === 'pending').length;
  const currentMeta = ROUTE_META[location.pathname] ?? ROUTE_META['/'];

  return (
    <div className="dashboard-layout">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo principal
      </a>

      {/* Backdrop para o menu hambúrguer no mobile (DA-1 = C) */}
      <div
        className={`sidebar-backdrop ${mobileSidebarOpen ? 'backdrop-open' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* === SIDEBAR / DRAWER DE NAVEGAÇÃO (DA-1 = C + DA-5 = C) === */}
      <aside
        className={`sidebar ${mobileSidebarOpen ? 'sidebar-open' : ''}`}
        aria-label="Menu lateral de navegação"
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-left">
            <span className="brand-icon">
              <HomeIcon />
            </span>
            <div>
              <div className="sidebar-brand-title">{household?.name ?? 'Finanças Família'}</div>
              <div className="sidebar-brand-sub">Gestão Financeira Privada</div>
            </div>
          </div>

          <button
            type="button"
            className="icon-btn sidebar-close-btn"
            aria-label="Fechar menu"
            onClick={() => setMobileSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* Seletor de Ambiente na Sidebar */}
        <div className="sidebar-ws-box" role="group" aria-label="Alternar ambiente ativo">
          <span className="sidebar-ws-label">Ambiente</span>
          <div className="sidebar-ws-pills">
            {workspaces.map((ws) => {
              const active = ws.id === activeWsId;
              const isPersonal = ws.kind === 'personal';
              return (
                <button
                  key={ws.id}
                  type="button"
                  className="sidebar-ws-pill"
                  aria-pressed={active}
                  onClick={() => setActiveWsId(ws.id)}
                >
                  {isPersonal ? 'Individual 🔒' : 'Coletivo'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navegação por Rotas Declarativas (react-router v7) */}
        <nav className="sidebar-nav" aria-label="Seções do sistema">
          <span className="sidebar-section-label">Principal</span>

          <NavLink to="/" end className="nav-item">
            <span className="nav-item-left">
              <HomeIcon />
              <span>Início</span>
            </span>
          </NavLink>

          <NavLink to="/lancamentos" className="nav-item">
            <span className="nav-item-left">
              <ListIcon />
              <span>Lançamentos</span>
            </span>
            <span className="nav-badge">{expenses.length}</span>
          </NavLink>

          <NavLink to="/saldos" className="nav-item">
            <span className="nav-item-left">
              <ScaleIcon />
              <span>Saldos & Reembolsos</span>
            </span>
            {pendingSettlementsCount > 0 && (
              <span className="nav-badge nav-badge-alert">{pendingSettlementsCount}</span>
            )}
          </NavLink>

          <NavLink to="/recorrentes" className="nav-item">
            <span className="nav-item-left">
              <RepeatIcon />
              <span>Recorrentes & Assinaturas</span>
            </span>
            <span className="nav-badge">{activeRecurringCount}</span>
          </NavLink>

          <NavLink to="/relatorios" className="nav-item">
            <span className="nav-item-left">
              <ChartIcon />
              <span>Relatórios (CSV / PDF)</span>
            </span>
          </NavLink>

          <span className="sidebar-section-label">Automação & Cadastros</span>

          <NavLink to="/android" className="nav-item">
            <span className="nav-item-left">
              <PhoneIcon />
              <span>Captura Android & Fila</span>
            </span>
            <span className={`nav-badge ${bankImports.length > 0 ? 'nav-badge-alert' : ''}`}>
              {bankImports.length}
            </span>
          </NavLink>

          <NavLink to="/cadastros" className="nav-item">
            <span className="nav-item-left">
              <TagIcon />
              <span>Cadastros</span>
            </span>
          </NavLink>

          <NavLink to="/notificacoes" className="nav-item">
            <span className="nav-item-left">
              <BellIcon />
              <span>Notificações</span>
            </span>
            <span className={`nav-badge ${unreadCount > 0 ? 'nav-badge-alert' : ''}`}>
              {unreadCount}
            </span>
          </NavLink>
        </nav>

        {/* Rodapé da Sidebar */}
        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-role">
              {household ? `${household.members.length} membros na casa` : user.email}
            </span>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      {/* === ÁREA PRINCIPAL (BARRA SUPERIOR + ROTAS + FAB + SHEETS) === */}
      <div className="dashboard-main">
        <header className="main-header">
          <div className="main-header-left">
            <button
              type="button"
              className="icon-btn mobile-menu-btn"
              aria-label="Abrir menu de navegação"
              onClick={() => setMobileSidebarOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
            {location.pathname !== '/' && (
              <button
                type="button"
                className="back-home-btn"
                aria-label="Voltar ao Início"
                onClick={() => navigate('/')}
              >
                ← Início
              </button>
            )}
            <div>
              <h1>{currentMeta.title}</h1>
            </div>
          </div>

          <div className="topbar-controls">
            {/* Seletor compacto de Ambiente no topo */}
            {workspaces.length > 0 && (
              <div
                className="ws-switcher-inline"
                role="group"
                aria-label="Seletor rápido de ambiente"
              >
                {workspaces.map((ws) => {
                  const active = ws.id === activeWsId;
                  const isPersonal = ws.kind === 'personal';
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      className="ws-chip-btn"
                      aria-pressed={active}
                      onClick={() => setActiveWsId(ws.id)}
                    >
                      {isPersonal ? 'Individual 🔒' : 'Coletivo'}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Botão 👁 Ocultar Valores (DA-4 = A) */}
            <button
              type="button"
              className="icon-btn"
              aria-label={hideValues ? 'Mostrar valores monetários' : 'Ocultar valores monetários'}
              aria-pressed={hideValues}
              title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
              onClick={onToggleHideValues}
            >
              <EyeIcon off={hideValues} />
            </button>

            {/* Botão 🌙/☀️ Alternar Tema Escuro/Claro (DA-2 = C) */}
            <button
              type="button"
              className="icon-btn"
              aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
              title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              onClick={onToggleTheme}
            >
              <ThemeIcon theme={theme} />
            </button>

            {/* Atalho de Notificações com Badge (alterna de volta ao Início se já estiver em /notificacoes) */}
            <button
              type="button"
              className="icon-btn"
              aria-label={
                location.pathname === '/notificacoes'
                  ? 'Voltar ao Início'
                  : `Notificações (${unreadCount} não lidas)`
              }
              aria-pressed={location.pathname === '/notificacoes'}
              title={location.pathname === '/notificacoes' ? 'Voltar ao Início' : 'Notificações'}
              onClick={() =>
                navigate(location.pathname === '/notificacoes' ? '/' : '/notificacoes')
              }
            >
              <BellIcon />
              {unreadCount > 0 && <span className="icon-btn-badge">{unreadCount}</span>}
            </button>

            {/* Botão + Nova despesa no cabeçalho desktop (DA-1 = C) */}
            <button
              type="button"
              className="btn btn-primary btn-sm btn-pill desktop-new-expense-btn"
              onClick={openNewExpenseSheet}
            >
              + Nova despesa
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {error && (
            <div className="alert-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setError(null)}
              >
                Fechar
              </button>
            </div>
          )}

          <Routes>
            <Route
              path="/"
              element={
                <HomeSection
                  user={user}
                  isCollective={isCollective}
                  period={period}
                  onPeriodChange={setPeriod}
                  totalCents={totalCents}
                  expenses={expenses}
                  reportSummary={reportSummary}
                  balances={balances}
                  settlements={settlements}
                  recurringRules={recurringRules}
                  bankImports={bankImports}
                  hideValues={hideValues}
                  onOpenNewExpense={openNewExpenseSheet}
                  onSelectExpense={setSelectedExpense}
                  onFilterCategoryAndNavigate={handleFilterCategoryFromHome}
                />
              }
            />

            <Route
              path="/lancamentos"
              element={
                <ExpensesSection
                  isCollective={isCollective}
                  categories={categories}
                  expenses={expenses}
                  totalCents={totalCents}
                  period={period}
                  onPeriodChange={setPeriod}
                  filterCatId={filterCatId}
                  onFilterCatChange={handleCategoryFilterChange}
                  hideValues={hideValues}
                  onOpenNewExpense={openNewExpenseSheet}
                  onSelectExpense={setSelectedExpense}
                />
              }
            />

            <Route
              path="/saldos"
              element={
                <SettlementsSection
                  user={user}
                  household={household}
                  balances={balances}
                  settlements={settlements}
                  hideValues={hideValues}
                  onRefresh={refreshAll}
                  onError={setError}
                />
              }
            />

            <Route
              path="/recorrentes"
              element={
                <RecurringSection
                  user={user}
                  household={household}
                  activeWsId={activeWsId}
                  isCollective={isCollective}
                  categories={categories}
                  paymentMethods={paymentMethods}
                  recurringRules={recurringRules}
                  hideValues={hideValues}
                  onRefresh={refreshAll}
                  onError={setError}
                />
              }
            />

            <Route
              path="/relatorios"
              element={
                <ReportsSection
                  activeWsId={activeWsId}
                  isCollective={isCollective}
                  reportSummary={reportSummary}
                  period={period}
                  onPeriodChange={setPeriod}
                  hideValues={hideValues}
                />
              }
            />

            <Route
              path="/android"
              element={
                <AndroidImportsSection
                  workspaces={workspaces}
                  activeWsId={activeWsId}
                  categories={categories}
                  devices={devices}
                  bankImports={bankImports}
                  hideValues={hideValues}
                  onRefresh={refreshAll}
                  onError={setError}
                />
              }
            />

            <Route
              path="/cadastros"
              element={
                <CatalogsSection
                  user={user}
                  household={household}
                  categories={categories}
                  paymentMethods={paymentMethods}
                  onCategoryCreated={(cat) =>
                    setCategories((prev) =>
                      [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                  }
                  onPaymentMethodCreated={(pm) =>
                    setPaymentMethods((prev) =>
                      [...prev, pm].sort((a, b) => a.name.localeCompare(b.name)),
                    )
                  }
                  onError={setError}
                />
              }
            />

            <Route
              path="/notificacoes"
              element={
                <NotificationsSection
                  notifications={notifications}
                  unreadCount={unreadCount}
                  onRefresh={loadNotifications}
                  onBackHome={() => navigate('/')}
                />
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Botão Flutuante FAB "+" no Mobile (DA-1 = C) */}
        <button
          type="button"
          className="fab-btn"
          aria-label="Nova despesa"
          title="Nova despesa"
          onClick={openNewExpenseSheet}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Sheet / Modal: Nova ou Editar Despesa */}
        <ExpenseFormSheet
          open={expenseFormOpen}
          onClose={() => setExpenseFormOpen(false)}
          editingExpense={editingExpense}
          user={user}
          household={household}
          activeWsId={activeWsId}
          isCollective={isCollective}
          categories={categories}
          paymentMethods={paymentMethods}
          onPaymentMethodCreated={(pm) =>
            setPaymentMethods((prev) =>
              [...prev, pm].sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
          onSaved={refreshAll}
          onError={setError}
        />

        {/* Sheet / Modal: Detalhes da Despesa (divisões, estorno, compartilhar, editar, excluir) */}
        <ExpenseDetailSheet
          expense={selectedExpense}
          isCollective={isCollective}
          hideValues={hideValues}
          onClose={() => setSelectedExpense(null)}
          onEdit={(exp) => openEditExpenseSheet(exp)}
          onRefresh={refreshAll}
          onError={setError}
        />
      </div>
    </div>
  );
}
