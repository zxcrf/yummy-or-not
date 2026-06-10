import { normalizePrice } from '../db'

describe('normalizePrice', () => {
  it('returns a bare numeric string to 2 decimals for numeric input', () => {
    expect(normalizePrice('18')).toBe('18.00')
    expect(normalizePrice('$5.80')).toBe('5.80')
    expect(normalizePrice('18.00')).toBe('18.00')
  })

  it('keeps empty and non-numeric behavior unchanged', () => {
    expect(normalizePrice('')).toBe('')
    expect(normalizePrice('   ')).toBe('')
    expect(normalizePrice('—')).toBe('—')
  })
})
