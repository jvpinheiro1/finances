import { describe, expect, it } from 'vitest';
import {
  centsToInput,
  formatBpsPercent,
  formatCentsBRL,
  formatMoneyDisplay,
  MASKED_MONEY,
  parseBRLToCents,
  parsePercentToBps,
  sanitizeMoneyInput,
  validateMoneyInput,
} from './format';

describe('format e ocultação de valores (DA-4 = A)', () => {
  it('formata centavos inteiros em BRL com separador de milhar e centavos', () => {
    expect(formatCentsBRL(0)).toBe('R$ 0,00');
    expect(formatCentsBRL(8990)).toBe('R$ 89,90');
    expect(formatCentsBRL(481237)).toBe('R$ 4.812,37');
    expect(formatCentsBRL(-21240)).toBe('- R$ 212,40');
  });

  it('mascara valores monetários quando hideValues=true', () => {
    expect(formatMoneyDisplay(481237, false)).toBe('R$ 4.812,37');
    expect(formatMoneyDisplay(481237, true)).toBe(MASKED_MONEY);
    expect(formatMoneyDisplay(-1500, true)).toBe(MASKED_MONEY);
    expect(formatMoneyDisplay(21240, false, { showPlusSign: true })).toBe('+ R$ 212,40');
    expect(formatMoneyDisplay(21240, true, { showPlusSign: true })).toBe(MASKED_MONEY);
  });

  it('converte string digitada em BRL (com vírgula ou ponto) para centavos inteiros sem float', () => {
    // Casos obrigatórios de integridade monetária ("23.33" nunca pode virar 233300!)
    expect(parseBRLToCents('23.33')).toBe(2333);
    expect(parseBRLToCents('23,33')).toBe(2333);
    expect(parseBRLToCents('23.5')).toBe(2350);
    expect(parseBRLToCents('23,5')).toBe(2350);
    expect(parseBRLToCents('1.234,56')).toBe(123456);
    expect(parseBRLToCents('R$ 1.234,56')).toBe(123456);
    expect(parseBRLToCents('89,90')).toBe(8990);
    expect(parseBRLToCents('45')).toBe(4500);

    // Entradas inválidas ou ambíguas devem retornar null
    expect(parseBRLToCents('23..33')).toBeNull();
    expect(parseBRLToCents('23,,33')).toBeNull();
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('-10')).toBeNull();
    expect(parseBRLToCents('0')).toBeNull();
    expect(parseBRLToCents('0,00')).toBeNull();
    expect(parseBRLToCents('0.00')).toBeNull();
    expect(parseBRLToCents('12,345')).toBeNull();
    expect(parseBRLToCents('12.345')).toBeNull();
    expect(parseBRLToCents('1,234.56')).toBeNull();
  });

  it('sanitiza e valida inputs monetários em tempo real', () => {
    expect(sanitizeMoneyInput('23.33')).toEqual({ value: '23,33', warning: null });
    expect(sanitizeMoneyInput('23,33')).toEqual({ value: '23,33', warning: null });
    expect(sanitizeMoneyInput('23..33')).toEqual({
      value: '23,33',
      warning: 'Use apenas um separador decimal (vírgula).',
    });
    expect(sanitizeMoneyInput('23,339')).toEqual({
      value: '23,33',
      warning: 'Máximo de 2 casas decimais (centavos).',
    });
    expect(sanitizeMoneyInput('45abc')).toEqual({
      value: '45',
      warning: 'Digite apenas números e vírgula (ex.: 23,33).',
    });

    expect(validateMoneyInput('', { required: true })).toBe('Informe um valor em reais (ex.: 23,33).');
    expect(validateMoneyInput('0,00')).toBe(
      'Informe um valor monetário válido maior que zero (ex.: 23,33).',
    );
    expect(validateMoneyInput('23,33')).toBeNull();
    expect(validateMoneyInput('23.33')).toBeNull();
    expect(validateMoneyInput('50,00', { maxCents: 3000 })).toBe(
      'O valor não pode ultrapassar R$ 30,00.',
    );
  });

  it('converte porcentagem para pontos-base (bps) e formata bps para string percentual', () => {
    expect(parsePercentToBps('50')).toBe(5000);
    expect(parsePercentToBps('33,33%')).toBe(3333);
    expect(formatBpsPercent(3800)).toBe('38%');
    expect(formatBpsPercent(3842)).toBe('38,4%');
    expect(formatBpsPercent(3842, 0)).toBe('38%');
  });

  it('formata centavos para campo de input', () => {
    expect(centsToInput(8990)).toBe('89,90');
    expect(centsToInput(500)).toBe('5,00');
  });
});
