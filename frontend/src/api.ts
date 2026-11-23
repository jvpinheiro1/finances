export interface User {
  id: string;
  household_id: string;
  name: string;
  email: string;
  must_change_password: boolean;
}

export interface Member {
  id: string;
  name: string;
}

export interface Household {
  id: string;
  name: string;
  members: Member[];
}

export interface Workspace {
  id: string;
  kind: 'household' | 'personal';
  is_mine: boolean;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  is_archived: boolean;
}

export type PaymentKind = 'pix' | 'debit' | 'credit_card' | 'cash' | 'transfer' | 'other';

export interface PaymentMethod {
  id: string;
  household_id: string;
  owner_user_id?: string;
  is_personal: boolean;
  name: string;
  kind: PaymentKind;
  last4?: string;
  closing_day?: number;
  due_day?: number;
  is_archived: boolean;
}

export type SplitStrategy = 'equal' | 'exact' | 'percentage' | 'shares';

export interface SplitShare {
  user_id: string;
  user_name?: string;
  weight_bps?: number;
  share_cents: number;
}

export interface SplitInput {
  user_id: string;
  weight_bps?: number;
  share_cents?: number;
}

export interface Expense {
  id: string;
  household_id: string;
  workspace_id: string;
  category_id: string;
  category_name: string;
  payment_method_id?: string;
  payment_method_name?: string;
  payment_method_kind?: PaymentKind;
  payment_method_last4?: string;
  paid_by_user_id: string;
  paid_by_name: string;
  created_by_user_id: string;
  amount_cents: number;
  refunded_cents: number;
  net_amount_cents: number;
  description: string;
  incurred_on: string;
  notes: string;
  split_strategy: SplitStrategy;
  splits: SplitShare[];
  installment_plan_id?: string;
  installment_number?: number;
  total_installments?: number;
  recurring_rule_id?: string;
  recurring_period?: string;
  shared_at?: string;
  created_at: string;
  updated_at: string;
}

export type RecurringFrequency = 'monthly' | 'weekly' | 'yearly';

export interface RecurringRule {
  id: string;
  household_id: string;
  workspace_id: string;
  category_id: string;
  category_name: string;
  payment_method_id?: string;
  payment_method_name?: string;
  payment_method_kind?: PaymentKind;
  payment_method_last4?: string;
  paid_by_user_id: string;
  paid_by_name: string;
  created_by_user_id: string;
  amount_cents: number;
  description: string;
  notes: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string;
  next_due_date: string;
  split_strategy: SplitStrategy;
  splits: SplitShare[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecurringRulePayload {
  category_id: string;
  payment_method_id?: string | null;
  paid_by_user_id?: string;
  amount_cents: number;
  description: string;
  notes: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string | null;
  split_strategy?: SplitStrategy;
  splits?: SplitInput[];
  is_active?: boolean;
}

export interface Refund {
  id: string;
  expense_id: string;
  household_id: string;
  amount_cents: number;
  refunded_on: string;
  reason: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
}

export interface ExpenseListResponse {
  items: Expense[];
  total_cents: number;
  count: number;
}

export interface ExpensePayload {
  category_id: string;
  payment_method_id?: string | null;
  paid_by_user_id?: string;
  amount_cents: number;
  description: string;
  incurred_on: string;
  notes: string;
  split_strategy?: SplitStrategy;
  splits?: SplitInput[];
  total_installments?: number;
}

export interface MemberBalance {
  user_id: string;
  user_name: string;
  net_cents: number;
}

export interface PairDebt {
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  amount_cents: number;
}

export interface BalanceSummary {
  members: MemberBalance[];
  pairwise: PairDebt[];
}

export type SettlementStatus = 'pending' | 'confirmed' | 'rejected';

export interface Settlement {
  id: string;
  household_id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  amount_cents: number;
  status: SettlementStatus;
  paid_on: string;
  notes: string;
  created_by_user_id: string;
  decided_by_user_id?: string;
  decided_at?: string;
  created_at: string;
}

export type NotificationKind =
  | 'settlement_pending'
  | 'settlement_confirmed'
  | 'settlement_rejected'
  | 'collective_expense_added'
  | 'recurring_due_soon';

export interface AppNotification {
  id: string;
  household_id: string;
  recipient_user_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  entity_type?: string;
  entity_id?: string;
  is_read: boolean;
  read_at?: string;
  created_at: string;
}

export interface NotificationListResponse {
  items: AppNotification[];
  unread_count: number;
}

export interface ReportCategoryRow {
  category_id: string;
  category_name: string;
  expense_count: number;
  total_net_cents: number;
  share_bps: number;
}

export interface ReportPaymentMethodRow {
  label: string;
  expense_count: number;
  total_net_cents: number;
  share_bps: number;
}

export interface ReportMemberRow {
  user_id: string;
  user_name: string;
  paid_net_cents: number;
  consumed_net_cents: number;
  delta_cents: number;
}

export interface ReportSummary {
  workspace_id: string;
  workspace_kind: 'household' | 'personal';
  from_date: string;
  to_date: string;
  expense_count: number;
  total_gross_cents: number;
  total_refunded_cents: number;
  total_net_cents: number;
  by_category: ReportCategoryRow[];
  by_payment_method: ReportPaymentMethodRow[];
  by_member: ReportMemberRow[];
}

export interface AndroidDevice {
  id: string;
  user_id: string;
  device_name: string;
  last_used_at?: string;
  revoked_at?: string;
  created_at: string;
}

export interface BankImportItem {
  id: string;
  household_id: string;
  owner_user_id: string;
  device_token_id?: string;
  bank_code: string;
  parse_status: 'parsed' | 'needs_review';
  parsed_amount_cents?: number;
  merchant_or_title: string;
  card_last4?: string;
  payment_kind: string;
  parsed_installments: number;
  occurred_on: string;
  status: 'pending' | 'approved' | 'discarded';
  approved_expense_id?: string;
  created_at: string;
}

// Formata centavos inteiros em BRL ("R$ 123,45") usando apenas aritmética inteira.
export function formatCentsBRL(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  const reaisFormatted = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '- ' : ''}R$ ${reaisFormatted},${centavos}`;
}

// Converte string digitada ("123,45" ou "123") para centavos inteiros, sem float.
export function parseBRLToCents(raw: string): number | null {
  const cleaned = raw.replace(/[R$\s.]/g, '').trim();
  if (!cleaned) return null;
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const reais = parseInt(match[1], 10);
  const centStr = (match[2] ?? '').padEnd(2, '0');
  const centavos = parseInt(centStr, 10);
  const total = reais * 100 + centavos;
  return total > 0 ? total : null;
}

// Converte porcentagem digitada ("50" ou "33,33") para pontos-base inteiros (100% = 10000 bps), sem float.
export function parsePercentToBps(raw: string): number | null {
  const cleaned = raw.replace(/[%\s]/g, '').trim();
  if (!cleaned) return null;
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = parseInt(match[1], 10);
  const frac = parseInt((match[2] ?? '').padEnd(2, '0'), 10);
  const bps = whole * 100 + frac;
  return bps > 0 && bps <= 10000 ? bps : null;
}

// Formata centavos para o campo de input ("123,45").
export function centsToInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const centavos = String(abs % 100).padStart(2, '0');
  return `${reais},${centavos}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-Requested-With'] = '1';
  }
  const resp = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204) {
    return undefined as T;
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const code = data?.error?.code ?? 'error';
    const msg = data?.error?.message ?? 'Erro inesperado na comunicação com o servidor';
    throw new ApiError(resp.status, code, msg);
  }
  return data as T;
}

export const api = {
  me: () => request<User>('GET', '/api/v1/auth/me'),
  login: (email: string, password: string) =>
    request<User>('POST', '/api/v1/auth/login', { email, password }),
  logout: () => request<void>('POST', '/api/v1/auth/logout'),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('POST', '/api/v1/auth/password', { current_password, new_password }),
  getHousehold: () => request<Household>('GET', '/api/v1/household'),
  listWorkspaces: () => request<{ items: Workspace[] }>('GET', '/api/v1/workspaces'),

  listCategories: () => request<{ items: Category[] }>('GET', '/api/v1/categories'),
  createCategory: (name: string) => request<Category>('POST', '/api/v1/categories', { name }),

  listPaymentMethods: () => request<{ items: PaymentMethod[] }>('GET', '/api/v1/payment-methods'),
  createPaymentMethod: (payload: {
    name: string;
    kind: PaymentKind;
    last4?: string;
    closing_day?: number;
    due_day?: number;
    is_personal: boolean;
  }) => request<PaymentMethod>('POST', '/api/v1/payment-methods', payload),

  listExpenses: (
    wsId: string,
    filters?: { from?: string; to?: string; category_id?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.category_id) params.set('category_id', filters.category_id);
    const qs = params.toString();
    return request<ExpenseListResponse>(
      'GET',
      `/api/v1/workspaces/${wsId}/expenses${qs ? `?${qs}` : ''}`,
    );
  },
  createExpense: (wsId: string, payload: ExpensePayload) =>
    request<Expense>('POST', `/api/v1/workspaces/${wsId}/expenses`, payload),
  updateExpense: (id: string, payload: ExpensePayload) =>
    request<Expense>('PATCH', `/api/v1/expenses/${id}`, payload),
  deleteExpense: (id: string) => request<void>('DELETE', `/api/v1/expenses/${id}`),
  deleteInstallmentPlan: (planId: string) =>
    request<void>('DELETE', `/api/v1/installment-plans/${planId}`),
  shareExpenseWithHousehold: (id: string) =>
    request<Expense>('POST', `/api/v1/expenses/${id}/share-with-household`),

  listRefunds: (expenseId: string) =>
    request<{ items: Refund[] }>('GET', `/api/v1/expenses/${expenseId}/refunds`),
  createRefund: (
    expenseId: string,
    payload: { amount_cents: number; refunded_on: string; reason: string },
  ) => request<Expense>('POST', `/api/v1/expenses/${expenseId}/refunds`, payload),

  listRecurringRules: (wsId: string) =>
    request<{ items: RecurringRule[] }>('GET', `/api/v1/workspaces/${wsId}/recurring-rules`),
  createRecurringRule: (wsId: string, payload: RecurringRulePayload) =>
    request<RecurringRule>('POST', `/api/v1/workspaces/${wsId}/recurring-rules`, payload),
  updateRecurringRule: (id: string, payload: RecurringRulePayload) =>
    request<RecurringRule>('PATCH', `/api/v1/recurring-rules/${id}`, payload),
  deleteRecurringRule: (id: string) =>
    request<void>('DELETE', `/api/v1/recurring-rules/${id}`),
  generateRecurringRules: (wsId: string, up_to_date?: string) =>
    request<{ generated_count: number; items: Expense[] }>(
      'POST',
      `/api/v1/workspaces/${wsId}/recurring-rules/generate`,
      up_to_date ? { up_to_date } : {},
    ),

  getBalances: () => request<BalanceSummary>('GET', '/api/v1/balances'),
  listSettlements: () => request<{ items: Settlement[] }>('GET', '/api/v1/settlements'),
  createSettlement: (payload: {
    from_user_id: string;
    to_user_id: string;
    amount_cents: number;
    paid_on: string;
    notes: string;
  }) => request<Settlement>('POST', '/api/v1/settlements', payload),
  confirmSettlement: (id: string) =>
    request<Settlement>('POST', `/api/v1/settlements/${id}/confirm`),
  rejectSettlement: (id: string) =>
    request<Settlement>('POST', `/api/v1/settlements/${id}/reject`),

  listNotifications: (unreadOnly = false) =>
    request<NotificationListResponse>(
      'GET',
      `/api/v1/notifications${unreadOnly ? '?unread_only=true' : ''}`,
    ),
  markNotificationRead: (id: string) =>
    request<AppNotification>('POST', `/api/v1/notifications/${id}/read`),
  markAllNotificationsRead: () =>
    request<{ marked_read_count: number }>('POST', '/api/v1/notifications/read-all'),

  getReportSummary: (wsId: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request<ReportSummary>(
      'GET',
      `/api/v1/workspaces/${wsId}/reports/summary${qs ? `?${qs}` : ''}`,
    );
  },
  reportExportUrl: (wsId: string, format: 'csv' | 'pdf', from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return `/api/v1/workspaces/${wsId}/reports/export.${format}${qs ? `?${qs}` : ''}`;
  },

  listDevices: () => request<{ items: AndroidDevice[] }>('GET', '/api/v1/devices'),
  createDevice: (device_name: string) =>
    request<{ device: AndroidDevice; plain_token: string }>('POST', '/api/v1/devices', {
      device_name,
    }),
  revokeDevice: (id: string) => request<AndroidDevice>('DELETE', `/api/v1/devices/${id}`),

  listImports: (status = 'pending') =>
    request<{ items: BankImportItem[] }>('GET', `/api/v1/imports?status=${status}`),
  approveImport: (
    id: string,
    payload: {
      workspace_id: string;
      category_id: string;
      amount_cents?: number;
      description?: string;
      total_installments?: number;
    },
  ) => request<Expense>('POST', `/api/v1/imports/${id}/approve`, payload),
  discardImport: (id: string) => request<BankImportItem>('POST', `/api/v1/imports/${id}/discard`),
};
