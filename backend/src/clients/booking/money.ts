// Money: ISO 4217 currencies (PHP, USD, ...) and amounts shown as the business would write them,
// e.g. 1500 PHP -> "₱1,500", 49.5 USD -> "$49.50".
const KNOWN = new Set<string>((Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency') ?? ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'HKD', 'AED']);

export const isCurrency = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v) && KNOWN.has(v);

/** 1500, "PHP" -> "₱1,500"; cents only when there are some. */
export function formatMoney(value: number | string | { toString(): string }, currency: string) {
  const n = Number(value.toString());
  const whole = Number.isInteger(n);
  return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(n);
}
