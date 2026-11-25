import { ReportCategoryRow } from '../api';
import { buildDonutSegments } from '../utils/categoryVisuals';
import { formatBpsPercent, formatMoneyDisplay } from '../utils/format';

export function DonutChart({
  rows,
  totalCents,
  expenseCount,
  hideValues,
  onSelectCategory,
}: {
  rows: ReportCategoryRow[];
  totalCents: number;
  expenseCount: number;
  hideValues: boolean;
  onSelectCategory?: (categoryId: string) => void;
}) {
  const segments = buildDonutSegments(rows);
  const topCat = segments[0];

  const ariaSummary =
    segments.length === 0
      ? 'Gráfico de despesas por categoria: nenhuma despesa no período.'
      : `Gráfico de despesas por categoria. Total ${formatMoneyDisplay(totalCents, hideValues)} em ${expenseCount} lançamentos. Maior categoria: ${topCat.category_name} (${formatBpsPercent(topCat.share_bps)}).`;

  return (
    <div className="donut-wrapper" role="img" aria-label={ariaSummary}>
      <svg viewBox="0 0 42 42" className="donut-svg">
        {/* Trilho de fundo */}
        <circle
          cx="21"
          cy="21"
          r="15.91549431"
          fill="transparent"
          stroke="var(--surface-3)"
          strokeWidth="5.2"
        />

        {segments.map((seg) => (
          <circle
            key={seg.category_id}
            className="donut-segment"
            cx="21"
            cy="21"
            r="15.91549431"
            fill="transparent"
            stroke={seg.visual.colorVar}
            strokeWidth="5.2"
            pathLength={100}
            strokeDasharray={`${Math.max(0.5, seg.dashLength - (segments.length > 1 ? 0.8 : 0))} ${100 - Math.max(0.5, seg.dashLength - (segments.length > 1 ? 0.8 : 0))}`}
            strokeDashoffset={seg.dashOffset}
            onClick={() => onSelectCategory?.(seg.category_id)}
          >
            <title>
              {seg.category_name}: {formatMoneyDisplay(seg.total_net_cents, hideValues)} (
              {formatBpsPercent(seg.share_bps)})
            </title>
          </circle>
        ))}
      </svg>

      <div className="donut-center">
        <span className="donut-center-label">Total</span>
        <span className="donut-center-value">{formatMoneyDisplay(totalCents, hideValues)}</span>
        <span className="donut-center-sub">
          {expenseCount} {expenseCount === 1 ? 'lançamento' : 'lançamentos'}
        </span>
      </div>
    </div>
  );
}
