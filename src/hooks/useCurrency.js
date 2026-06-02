/**
 * Configurable currency formatting.
 * Default: USD ($). Supports ILS (₪) for Israeli market.
 */
import useStore from '../store/useStore';

const CURRENCY_SYMBOLS = { USD: '$', ILS: '₪', EUR: '€' };

export const useCurrency = () => {
  const currency = useStore((s) => s.currency) || 'USD';
  const setCurrency = useStore((s) => s.setCurrency);
  const symbol = CURRENCY_SYMBOLS[currency] || '$';

  const format = (amount, options = {}) => {
    if (amount == null || isNaN(amount)) return '—';
    const { decimals = 0, compact = false } = options;
    const num = Number(amount);
    if (compact && Math.abs(num) >= 1000) {
      const k = num / 1000;
      return `${symbol}${k.toFixed(1)}k`;
    }
    return `${symbol}${num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  };

  return { currency, symbol, format, setCurrency };
};

export default useCurrency;
