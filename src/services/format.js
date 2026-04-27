import { useAuthStore } from '../stores/auth'

const SYMBOLS = { USD: '$', INR: '₹' }
const LOCALES = { USD: 'en-US', INR: 'en-IN' }

export function currencyCode() {
  const auth = useAuthStore()
  return auth.user?.preferences?.currency || 'USD'
}

export function currencySymbol() {
  return SYMBOLS[currencyCode()] || '$'
}

export function formatMoney(amount, opts = {}) {
  const code = currencyCode()
  const value = Number(amount || 0)
  try {
    return new Intl.NumberFormat(LOCALES[code] || 'en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: opts.fractionDigits ?? 0,
    }).format(value)
  } catch {
    return `${SYMBOLS[code] || '$'}${value.toLocaleString()}`
  }
}
