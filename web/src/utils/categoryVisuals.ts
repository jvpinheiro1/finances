import { ReportCategoryRow } from '../api';

export type CategoryIconKind =
  | 'food'
  | 'home'
  | 'bills'
  | 'transport'
  | 'health'
  | 'leisure'
  | 'education'
  | 'shopping'
  | 'pet'
  | 'subscription'
  | 'other';

export interface CategoryVisual {
  icon: CategoryIconKind;
  /** Variável CSS de cor (ex.: var(--cat-1)) */
  colorVar: string;
  /** Índice de 0 a 7 na paleta de 8 cores dessaturadas */
  colorIndex: number;
  /** Inicial maiúscula para fallback textual */
  initial: string;
}

export const CATEGORY_COLOR_VARS = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
  'var(--cat-8)',
] as const;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Resolve o ícone e a cor de uma categoria no frontend (DA-3 = A),
 * mapeando as 8 categorias padrão da residência + termos frequentes e
 * usando fallback determinístico para novas categorias.
 */
export function getCategoryVisual(name: string, idOrIndex?: string | number): CategoryVisual {
  const norm = normalizeText(name);
  const trimmed = name.trim();
  const initial = trimmed ? trimmed.charAt(0).toUpperCase() : '?';

  let icon: CategoryIconKind = 'other';
  let defaultColorIndex: number | null = null;

  if (
    norm.includes('aliment') ||
    norm.includes('mercad') ||
    norm.includes('supermercad') ||
    norm.includes('restaur') ||
    norm.includes('lanche') ||
    norm.includes('padaria') ||
    norm.includes('comida') ||
    norm.includes('feira')
  ) {
    icon = 'food';
    defaultColorIndex = 0;
  } else if (
    norm.includes('morad') ||
    norm.includes('aluguel') ||
    norm.includes('condomin') ||
    norm.includes('casa') ||
    norm.includes('obra') ||
    norm.includes('reforma')
  ) {
    icon = 'home';
    defaultColorIndex = 1;
  } else if (
    norm.includes('conta') ||
    norm.includes('luz') ||
    norm.includes('agua') ||
    norm.includes('energia') ||
    norm.includes('gas') ||
    norm.includes('internet') ||
    norm.includes('telefone')
  ) {
    icon = 'bills';
    defaultColorIndex = 2;
  } else if (
    norm.includes('transp') ||
    norm.includes('combust') ||
    norm.includes('gasolina') ||
    norm.includes('uber') ||
    norm.includes('carro') ||
    norm.includes('onibus') ||
    norm.includes('metro') ||
    norm.includes('pedagio')
  ) {
    icon = 'transport';
    defaultColorIndex = 3;
  } else if (
    norm.includes('saud') ||
    norm.includes('farmac') ||
    norm.includes('medic') ||
    norm.includes('remedio') ||
    norm.includes('hospital') ||
    norm.includes('consulta') ||
    norm.includes('exame')
  ) {
    icon = 'health';
    defaultColorIndex = 4;
  } else if (
    norm.includes('lazer') ||
    norm.includes('cinema') ||
    norm.includes('viag') ||
    norm.includes('passeio') ||
    norm.includes('show') ||
    norm.includes('jogo')
  ) {
    icon = 'leisure';
    defaultColorIndex = 5;
  } else if (
    norm.includes('educa') ||
    norm.includes('escola') ||
    norm.includes('faculd') ||
    norm.includes('curso') ||
    norm.includes('livro')
  ) {
    icon = 'education';
    defaultColorIndex = 6;
  } else if (norm.includes('pet') || norm.includes('veterin') || norm.includes('racao')) {
    icon = 'pet';
    defaultColorIndex = 1;
  } else if (
    norm.includes('assinatura') ||
    norm.includes('stream') ||
    norm.includes('netflix') ||
    norm.includes('spotify')
  ) {
    icon = 'subscription';
    defaultColorIndex = 4;
  } else if (norm.includes('compra') || norm.includes('roupa') || norm.includes('vestuar')) {
    icon = 'shopping';
    defaultColorIndex = 6;
  } else if (norm.includes('outro')) {
    icon = 'other';
    defaultColorIndex = 7;
  }

  let colorIndex: number;
  if (defaultColorIndex !== null) {
    colorIndex = defaultColorIndex;
  } else if (typeof idOrIndex === 'number' && Number.isFinite(idOrIndex)) {
    colorIndex = Math.abs(Math.trunc(idOrIndex)) % CATEGORY_COLOR_VARS.length;
  } else {
    const seed = typeof idOrIndex === 'string' && idOrIndex ? `${norm}:${idOrIndex}` : norm;
    colorIndex = hashString(seed) % CATEGORY_COLOR_VARS.length;
  }

  return {
    icon,
    colorIndex,
    colorVar: CATEGORY_COLOR_VARS[colorIndex],
    initial,
  };
}

export interface DonutSegment {
  category_id: string;
  category_name: string;
  total_net_cents: number;
  expense_count: number;
  share_bps: number;
  visual: CategoryVisual;
  /** Comprimento do arco normalizado para circunferência 100 */
  dashLength: number;
  /** Offset acumulado normalizado para circunferência 100 */
  dashOffset: number;
}

/**
 * Calcula os segmentos geométricos do gráfico Donut SVG (circunferência normalizada = 100)
 * a partir das linhas de categoria do relatório.
 */
export function buildDonutSegments(rows: ReportCategoryRow[]): DonutSegment[] {
  const positiveRows = rows.filter((r) => r.total_net_cents > 0);
  const totalCents = positiveRows.reduce((acc, r) => acc + r.total_net_cents, 0);
  if (totalCents <= 0) {
    return [];
  }

  let accumulated = 0;
  return positiveRows.map((row, idx) => {
    const ratio = row.total_net_cents / totalCents;
    const rawLength = ratio * 100;
    const dashLength =
      idx === positiveRows.length - 1 ? Math.max(0, 100 - accumulated) : rawLength;
    const dashOffset = -accumulated;
    accumulated += dashLength;

    return {
      category_id: row.category_id,
      category_name: row.category_name,
      total_net_cents: row.total_net_cents,
      expense_count: row.expense_count,
      share_bps: row.share_bps,
      visual: getCategoryVisual(row.category_name, row.category_id),
      dashLength,
      dashOffset,
    };
  });
}
