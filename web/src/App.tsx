import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AndroidDevice,
  api,
  ApiError,
  AppNotification,
  BalanceSummary,
  BankImportItem,
  Category,
  Expense,
  formatCentsBRL,
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
import { ExpensesSection } from './components/ExpensesSection';
import { NotificationsSection } from './components/NotificationsSection';
import { RecurringSection } from './components/RecurringSection';
import { ReportsSection } from './components/ReportsSection';
import { SettlementsSection } from './components/SettlementsSection';

type NavSection =
  | 'expenses'
  | 'settlements'
  | 'recurring'
  | 'reports'
  | 'android'
  | 'catalogs'
  | 'notifications';

const SECTION_META: Record<NavSection, { title: string; subtitle: string }> = {
  expenses: {
    title: 'Visão Geral & Despesas',
    subtitle: 'Lançamentos, compras parceladas (1x a 48x), rateio coletivo e estornos.',
  },
  settlements: {
    title: 'Saldos & Reembolsos da Família',
    subtitle: 'Posição líquida consolidada, quem deve para quem e confirmação de acertos.',
  },
  recurring: {
    title: 'Recorrentes & Assinaturas',
    subtitle: 'Contas fixas ou variáveis e assinaturas mensais/anuais com geração automática.',
  },
  reports: {
    title: 'Relatórios Financeiros (CSV / PDF)',
    subtitle: 'Consolidação por categoria, meio de pagamento e membro com exportação nativa.',
  },
  android: {
    title: 'App Android & Fila Bancária',
    subtitle: 'Pareamento de celular e revisão privada de notificações bancárias capturadas.',
  },
  catalogs: {
    title: 'Categorias, Cartões & Família',
    subtitle: 'Gestão de categorias, cartões (com fechamento/vencimento) e membros ativos.',
  },
  notifications: {
    title: 'Caixa de Entrada & Alertas',
    subtitle: 'Notificações privadas da sua conta sobre divisões, reembolsos e vencimentos.',
  },
};

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M16 12.5h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
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

function DashboardScreen({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [activeSection, setActiveSection] = useState<NavSection>('expenses');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

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

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null);

  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [bankImports, setBankImports] = useState<BankImportItem[]>([]);
  const prevUnreadRef = useRef<number>(0);

  const [error, setError] = useState<string | null>(null);

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
        // E6-D1 / ADR 0009: nunca expõe valores financeiros nem descrições privadas no banner do SO.
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
      loadWorkspaceData(activeWsId, filterFrom, filterTo, filterCatId),
      loadCollectiveBalances(),
    ]);
  }, [activeWsId, filterFrom, filterTo, filterCatId, loadWorkspaceData, loadCollectiveBalances]);

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
      void loadWorkspaceData(activeWsId, filterFrom, filterTo, filterCatId);
    }
  }, [activeWsId, filterFrom, filterTo, filterCatId, loadWorkspaceData]);

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  function handleSelectSection(section: NavSection) {
    setActiveSection(section);
    setMobileSidebarOpen(false);
  }

  const activeWorkspace = workspaces.find((w) => w.id === activeWsId);
  const isCollective = activeWorkspace?.kind === 'household';
  const myBalance = balances?.members.find((m) => m.user_id === user.id);
  const activeRecurringCount = recurringRules.filter((r) => r.is_active).length;
  const pendingSettlementsCount = settlements.filter((s) => s.status === 'pending').length;
  const currentMeta = SECTION_META[activeSection];

  return (
    <div className="dashboard-layout">
      {/* Backdrop para menu mobile */}
      <div
        className={`sidebar-backdrop ${mobileSidebarOpen ? 'backdrop-open' : ''}`}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* === SIDEBAR DE NAVEGAÇÃO LATERAL === */}
      <aside
        className={`sidebar ${mobileSidebarOpen ? 'sidebar-open' : ''}`}
        aria-label="Menu lateral de navegação"
      >
        <div className="sidebar-brand">
          <span className="brand-icon">
            <HomeIcon />
          </span>
          <div>
            <div className="sidebar-brand-title">{household?.name ?? 'Finanças Família'}</div>
            <div className="sidebar-brand-sub">Gestão Financeira Privada</div>
          </div>
        </div>

        {/* Seletor rápido de Ambiente (Coletivo vs Individual) */}
        <div className="sidebar-ws-box" role="group" aria-label="Alternar ambiente ativo">
          <span className="sidebar-ws-label">Ambiente Ativo (RLS)</span>
          <div className="sidebar-ws-pills">
            {workspaces.map((ws) => {
              const active = ws.id === activeWsId;
              const isPersonal = ws.kind === 'personal';
              return (
                <button
                  key={ws.id}
                  type="button"
                  className={`sidebar-ws-pill ${isPersonal ? 'pill-private' : ''}`}
                  aria-pressed={active}
                  onClick={() => setActiveWsId(ws.id)}
                >
                  {isPersonal ? 'Individual' : 'Coletivo'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Menu de Navegação por Seções Dedicadas */}
        <nav className="sidebar-nav" aria-label="Seções do sistema">
          <span className="sidebar-section-label">Financeiro</span>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'expenses' ? 'page' : undefined}
            onClick={() => handleSelectSection('expenses')}
          >
            <span className="nav-item-left">
              <WalletIcon />
              <span>Visão Geral & Despesas</span>
            </span>
            <span className="nav-badge">{expenses.length}</span>
          </button>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'settlements' ? 'page' : undefined}
            onClick={() => handleSelectSection('settlements')}
          >
            <span className="nav-item-left">
              <ScaleIcon />
              <span>Saldos & Reembolsos</span>
            </span>
            {pendingSettlementsCount > 0 && (
              <span className="nav-badge nav-badge-alert">{pendingSettlementsCount}</span>
            )}
          </button>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'recurring' ? 'page' : undefined}
            onClick={() => handleSelectSection('recurring')}
          >
            <span className="nav-item-left">
              <RepeatIcon />
              <span>Recorrentes & Assinaturas</span>
            </span>
            <span className="nav-badge">{activeRecurringCount}</span>
          </button>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'reports' ? 'page' : undefined}
            onClick={() => handleSelectSection('reports')}
          >
            <span className="nav-item-left">
              <ChartIcon />
              <span>Relatórios (CSV / PDF)</span>
            </span>
          </button>

          <span className="sidebar-section-label">Automação & Cadastros</span>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'android' ? 'page' : undefined}
            onClick={() => handleSelectSection('android')}
          >
            <span className="nav-item-left">
              <PhoneIcon />
              <span>App Android & Fila</span>
            </span>
            <span className={`nav-badge ${bankImports.length > 0 ? 'nav-badge-alert' : ''}`}>
              {bankImports.length}
            </span>
          </button>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'catalogs' ? 'page' : undefined}
            onClick={() => handleSelectSection('catalogs')}
          >
            <span className="nav-item-left">
              <TagIcon />
              <span>Categorias & Cartões</span>
            </span>
          </button>

          <button
            type="button"
            className="nav-item"
            aria-current={activeSection === 'notifications' ? 'page' : undefined}
            onClick={() => handleSelectSection('notifications')}
          >
            <span className="nav-item-left">
              <BellIcon />
              <span>Notificações</span>
            </span>
            <span className={`nav-badge ${unreadCount > 0 ? 'nav-badge-alert' : ''}`}>
              {unreadCount}
            </span>
          </button>
        </nav>

        {/* Rodapé da Sidebar: Usuário Logado + Sair */}
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

      {/* === ÁREA PRINCIPAL (CABEÇALHO + KPIS + SEÇÃO ATIVA) === */}
      <div className="dashboard-main">
        <header className="main-header">
          <div className="main-header-left">
            <button
              type="button"
              className="btn btn-outline btn-sm mobile-menu-btn"
              aria-label="Abrir menu de navegação"
              onClick={() => setMobileSidebarOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
            <div>
              <h1>{currentMeta.title}</h1>
              <p className="subtitle">{currentMeta.subtitle}</p>
            </div>
          </div>

          <div className="user-bar">
            {activeWorkspace && (
              <span className={`badge ${isCollective ? '' : 'badge-private'}`}>
                {isCollective
                  ? 'Espaço da Família (Coletivo)'
                  : 'Meu Espaço Individual (Privado)'}
              </span>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => handleSelectSection('notifications')}
            >
              <BellIcon />
              <span>Alertas ({unreadCount})</span>
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={refreshAll}>
              Atualizar
            </button>
          </div>
        </header>

        <main className="main-content">
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

          {/* Cards de KPI no Topo */}
          <section className="kpi-grid" aria-label="Indicadores financeiros do ambiente ativo">
            <div className="kpi-card">
              <span className="kpi-label">
                {isCollective ? 'Total Líquido (Família)' : 'Total Líquido (Individual)'}
              </span>
              <span className="kpi-value">{formatCentsBRL(totalCents)}</span>
              <span className="kpi-sub">
                {expenses.length} {expenses.length === 1 ? 'lançamento' : 'lançamentos'} no filtro
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Minha Posição na Casa</span>
              <span className="kpi-value">
                {myBalance
                  ? myBalance.net_cents > 0
                    ? `+${formatCentsBRL(myBalance.net_cents)}`
                    : formatCentsBRL(myBalance.net_cents)
                  : 'R$ 0,00'}
              </span>
              <span className="kpi-sub">
                {myBalance
                  ? myBalance.net_cents > 0
                    ? 'A receber dos familiares'
                    : myBalance.net_cents < 0
                      ? 'A reembolsar aos familiares'
                      : 'Quitado no ambiente coletivo'
                  : 'Calculando saldos…'}
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Assinaturas & Recorrentes</span>
              <span className="kpi-value">{activeRecurringCount}</span>
              <span className="kpi-sub">
                {recurringRules.length} cadastradas neste ambiente
              </span>
            </div>

            <div className="kpi-card">
              <span className="kpi-label">Fila Bancária Android</span>
              <span className="kpi-value">{bankImports.length}</span>
              <span className="kpi-sub">
                {bankImports.length === 0
                  ? 'Nenhuma notificação pendente'
                  : 'Aguardando sua revisão privada'}
              </span>
            </div>
          </section>

          {/* Renderização Exclusiva da Seção Selecionada na Sidebar */}
          {activeSection === 'expenses' && (
            <ExpensesSection
              user={user}
              household={household}
              activeWsId={activeWsId}
              isCollective={isCollective}
              categories={categories}
              paymentMethods={paymentMethods}
              expenses={expenses}
              totalCents={totalCents}
              filterFrom={filterFrom}
              filterTo={filterTo}
              filterCatId={filterCatId}
              onFilterFromChange={setFilterFrom}
              onFilterToChange={setFilterTo}
              onFilterCatChange={setFilterCatId}
              onRefresh={refreshAll}
              onError={setError}
            />
          )}

          {activeSection === 'settlements' && (
            <SettlementsSection
              user={user}
              household={household}
              balances={balances}
              settlements={settlements}
              onRefresh={refreshAll}
              onError={setError}
            />
          )}

          {activeSection === 'recurring' && (
            <RecurringSection
              user={user}
              household={household}
              activeWsId={activeWsId}
              isCollective={isCollective}
              categories={categories}
              paymentMethods={paymentMethods}
              recurringRules={recurringRules}
              onRefresh={refreshAll}
              onError={setError}
            />
          )}

          {activeSection === 'reports' && (
            <ReportsSection
              activeWsId={activeWsId}
              isCollective={isCollective}
              reportSummary={reportSummary}
              filterFrom={filterFrom}
              filterTo={filterTo}
              onFilterFromChange={setFilterFrom}
              onFilterToChange={setFilterTo}
            />
          )}

          {activeSection === 'android' && (
            <AndroidImportsSection
              workspaces={workspaces}
              activeWsId={activeWsId}
              categories={categories}
              devices={devices}
              bankImports={bankImports}
              onRefresh={refreshAll}
              onError={setError}
            />
          )}

          {activeSection === 'catalogs' && (
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
          )}

          {activeSection === 'notifications' && (
            <NotificationsSection
              notifications={notifications}
              unreadCount={unreadCount}
              onRefresh={loadNotifications}
            />
          )}
        </main>
      </div>
    </div>
  );
}
