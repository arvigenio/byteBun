import { useMemo } from 'react';
import { Input, Select } from '../ui.jsx';

// Money fields: an amount and an ISO 4217 currency (PHP, USD, ...). The business's currency
// (Settings) is the default wherever one is chosen.

const COMMON = ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'HKD', 'JPY', 'AED', 'SAR', 'MYR', 'IDR', 'THB', 'VND', 'INR', 'KRW', 'CNY', 'NZD'];

const allCurrencies = () => {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return COMMON;
  }
};

/** "PHP" -> "₱" (or the code when there's no symbol). */
export const currencySymbol = (code) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
};

/** 1500, "PHP" -> "₱1,500" */
export const fmtMoney = (value, code) => {
  const n = Number(value);
  if (!Number.isFinite(n) || !code) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${code} ${n}`;
  }
};

/** The <option>s: the common currencies first, then every other (code · name). */
export function CurrencyOptions({ placeholder }) {
  const options = useMemo(() => {
    let names;
    try {
      names = new Intl.DisplayNames(undefined, { type: 'currency' });
    } catch {
      names = null;
    }
    const label = (c) => `${c} · ${names?.of(c) ?? c}`;
    const rest = allCurrencies().filter((c) => !COMMON.includes(c));
    return { common: COMMON.map((c) => [c, label(c)]), rest: rest.map((c) => [c, label(c)]) };
  }, []);
  return (
    <>
      {placeholder && <option value="">{placeholder}</option>}
      <optgroup label="Common">
        {options.common.map(([c, l]) => (
          <option key={c} value={c}>
            {l}
          </option>
        ))}
      </optgroup>
      <optgroup label="All currencies">
        {options.rest.map(([c, l]) => (
          <option key={c} value={c}>
            {l}
          </option>
        ))}
      </optgroup>
    </>
  );
}

/** A currency list (common ones first). */
export function CurrencySelect({ value, onChange, placeholder = 'Choose a currency', className, ...rest }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={className} {...rest}>
      <CurrencyOptions placeholder={placeholder} />
    </Select>
  );
}

/**
 * An amount with its currency: the symbol inside the field, a currency list next to it
 * (`fixedCurrency` shows the currency without letting it change).
 */
export function MoneyField({ id, amount, currency, onAmount, onCurrency, fixedCurrency = false, invalid, placeholder = '0.00', autoFocus }) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative w-40">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold text-muted">{currency ? currencySymbol(currency) : '¤'}</span>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          value={amount}
          placeholder={placeholder}
          onChange={(e) => onAmount(e.target.value)}
          className="pl-9 tabular-nums"
        />
      </div>
      {fixedCurrency ? (
        <span className="inline-flex min-h-10 items-center rounded-btn bg-sunken px-3 text-sm font-semibold text-muted">{currency}</span>
      ) : (
        <CurrencySelect value={currency} onChange={onCurrency} aria-label="Currency" className="w-56" />
      )}
    </div>
  );
}
