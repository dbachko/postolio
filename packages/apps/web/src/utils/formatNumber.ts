import millify from 'millify';

/**
 * Formats a number to a human-readable string with appropriate suffixes (K, M, B)
 * Handles Prisma Decimal types by converting to Number first
 *
 * @param value - The number to format (supports number, string, or Prisma Decimal)
 * @param options - Formatting options
 * @returns Formatted string (e.g., "1.2K", "3.4M", "123")
 *
 * @example
 * formatNumber(1234) // "1.2K"
 * formatNumber(1234567) // "1.2M"
 * formatNumber(123) // "123"
 * formatNumber(1234.5678, { precision: 2 }) // "1.23K"
 */
export function formatNumber(
  value: number | string | unknown,
  options?: {
    precision?: number;
    lowercase?: boolean;
  }
): string {
  const numValue = Number(value);

  if (isNaN(numValue) || !isFinite(numValue)) {
    return '0';
  }

  // For very small numbers, just round to integer
  if (Math.abs(numValue) < 1000) {
    return Math.round(numValue).toString();
  }

  return millify(numValue, {
    precision: options?.precision ?? 1,
    lowercase: options?.lowercase ?? false,
  });
}

/**
 * Formats a percentage value with fixed decimal places
 *
 * @param value - The percentage value
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string (e.g., "12.3%")
 *
 * @example
 * formatPercent(12.345) // "12.3%"
 * formatPercent(12.345, 2) // "12.35%"
 */
export function formatPercent(value: number | string | unknown, decimals: number = 1): string {
  const numValue = Number(value);

  if (isNaN(numValue) || !isFinite(numValue)) {
    return '0%';
  }

  return `${numValue.toFixed(decimals)}%`;
}

/**
 * Formats a currency value with fixed decimal places
 *
 * @param value - The currency value
 * @param decimals - Number of decimal places (default: 2)
 * @param currency - Currency symbol (default: "$")
 * @returns Formatted currency string (e.g., "$12.34", "$1.2K")
 *
 * @example
 * formatCurrency(12.345) // "$12.35"
 * formatCurrency(1234.56) // "$1.2K"
 */
export function formatCurrency(
  value: number | string | unknown,
  decimals: number = 2,
  currency: string = '$'
): string {
  const numValue = Number(value);

  if (isNaN(numValue) || !isFinite(numValue)) {
    return `${currency}0`;
  }

  // For values less than 1000, show exact amount
  if (Math.abs(numValue) < 1000) {
    return `${currency}${numValue.toFixed(decimals)}`;
  }

  // For larger values, use K/M/B notation
  return `${currency}${millify(numValue, { precision: 1 })}`;
}

/**
 * Formats a growth/change percentage with sign
 *
 * @param value - The growth percentage
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted growth string (e.g., "+12.3%", "-5.4%")
 *
 * @example
 * formatGrowth(12.345) // "+12.3%"
 * formatGrowth(-5.432) // "-5.4%"
 */
export function formatGrowth(value: number | string | unknown, decimals: number = 1): string {
  const numValue = Number(value);

  if (isNaN(numValue) || !isFinite(numValue)) {
    return '0%';
  }

  const sign = numValue >= 0 ? '+' : '';
  return `${sign}${numValue.toFixed(decimals)}%`;
}
