import { centsToInput, formatCentsBRL, parseBRLToCents, parsePercentToBps } from '../api';

export { centsToInput, formatCentsBRL, parseBRLToCents, parsePercentToBps };

export const MASKED_MONEY = 'R$ ••••';

/**
 * Formata um valor em centavos inteiros para exibição na UI,
 * respeitando o modo de privacidade ("ocultar valores", DA-4 = A).
 */
export function formatMoneyDisplay(
  cents: number,
  hideValues = false,
  options?: { showPlusSign?: boolean },
): string {
  if (hideValues) {
    return MASKED_MONEY;
  }
  const formatted = formatCentsBRL(cents);
  if (options?.showPlusSign && cents > 0) {
    return `+ ${formatted}`;
  }
  return formatted;
}

/**
 * Formata pontos-base inteiros (10000 bps = 100%) para percentual pt-BR (ex.: "38,5%" ou "38%").
 * Usa apenas aritmética inteira sobre bps.
 */
export function formatBpsPercent(bps: number, decimals: 0 | 1 = 1): string {
  const clamped = Math.max(0, Math.trunc(bps));
  if (decimals === 0) {
    const rounded = Math.round(clamped / 100);
    return `${rounded}%`;
  }
  const tenths = Math.round(clamped / 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  if (frac === 0) {
    return `${whole}%`;
  }
  return `${whole},${frac}%`;
}

export interface SanitizeMoneyResult {
  value: string;
  warning: string | null;
}

/**
 * Sanitiza entrada monetária em tempo real:
 * - Converte ponto "." em vírgula "," automaticamente (ex.: "23.33" -> "23,33").
 * - Bloqueia letras, sinais negativos e caracteres não numéricos.
 * - Permite apenas um único separador decimal (vírgula) e no máximo 2 casas decimais.
 */
export function sanitizeMoneyInput(raw: string): SanitizeMoneyResult {
  if (!raw) {
    return { value: '', warning: null };
  }

  let warning: string | null = null;
  // Remove prefixo R$ e espaços caso o usuário cole um valor formatado
  let working = raw.replace(/R\$/gi, '').replace(/\s+/g, '');

  // Se o valor colado tiver formato "1.234,56" (ponto de milhar + vírgula decimal), remove os pontos de milhar
  if (/^\d{1,3}(?:\.\d{3})+,\d{0,2}$/.test(working)) {
    working = working.replace(/\./g, '');
  }

  let out = '';
  let hasComma = false;
  let decimalsCount = 0;

  for (const ch of working) {
    if (ch >= '0' && ch <= '9') {
      if (hasComma) {
        if (decimalsCount < 2) {
          out += ch;
          decimalsCount++;
        } else {
          warning = 'Máximo de 2 casas decimais (centavos).';
        }
      } else {
        out += ch;
      }
    } else if (ch === ',' || ch === '.') {
      if (!hasComma) {
        out = out === '' ? '0,' : `${out},`;
        hasComma = true;
      } else {
        warning = 'Use apenas um separador decimal (vírgula).';
      }
    } else {
      warning = 'Digite apenas números e vírgula (ex.: 23,33).';
    }
  }

  return { value: out, warning };
}

/**
 * Retorna mensagem de erro de validação para um campo monetário, ou null se válido.
 */
export function validateMoneyInput(
  raw: string,
  options?: { required?: boolean; maxCents?: number },
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return options?.required ? 'Informe um valor em reais (ex.: 23,33).' : null;
  }
  const cents = parseBRLToCents(trimmed);
  if (cents === null) {
    return 'Informe um valor monetário válido maior que zero (ex.: 23,33).';
  }
  if (options?.maxCents !== undefined && cents > options.maxCents) {
    return `O valor não pode ultrapassar ${formatCentsBRL(options.maxCents)}.`;
  }
  return null;
}
