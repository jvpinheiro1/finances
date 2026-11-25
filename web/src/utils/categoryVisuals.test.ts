import { describe, expect, it } from 'vitest';
import { buildDonutSegments, getCategoryVisual } from './categoryVisuals';

describe('categoryVisuals e Donut SVG (DA-3 = A)', () => {
  it('mapeia as 8 categorias padrão da residência para os ícones e cores esperados', () => {
    expect(getCategoryVisual('Alimentação').icon).toBe('food');
    expect(getCategoryVisual('Moradia').icon).toBe('home');
    expect(getCategoryVisual('Contas').icon).toBe('bills');
    expect(getCategoryVisual('Transporte').icon).toBe('transport');
    expect(getCategoryVisual('Saúde').icon).toBe('health');
    expect(getCategoryVisual('Lazer').icon).toBe('leisure');
    expect(getCategoryVisual('Educação').icon).toBe('education');
    expect(getCategoryVisual('Outros').icon).toBe('other');
  });

  it('aplica fallback determinístico com inicial maiúscula para categorias personalizadas', () => {
    const v1 = getCategoryVisual('Investimentos', 'cat-uuid-1');
    const v2 = getCategoryVisual('Investimentos', 'cat-uuid-1');
    expect(v1.initial).toBe('I');
    expect(v1.colorVar).toBe(v2.colorVar);
  });

  it('calcula segmentos do Donut SVG somando 100% da circunferência normalizada', () => {
    const segments = buildDonutSegments([
      {
        category_id: 'c1',
        category_name: 'Alimentação',
        expense_count: 10,
        total_net_cents: 60000,
        share_bps: 6000,
      },
      {
        category_id: 'c2',
        category_name: 'Moradia',
        expense_count: 5,
        total_net_cents: 40000,
        share_bps: 4000,
      },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].dashLength).toBeCloseTo(60, 5);
    expect(segments[0].dashOffset).toBeCloseTo(0, 5);
    expect(segments[1].dashLength).toBeCloseTo(40, 5);
    expect(segments[1].dashOffset).toBeCloseTo(-60, 5);
    expect(segments[0].dashLength + segments[1].dashLength).toBeCloseTo(100, 5);
  });
});
