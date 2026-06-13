/* ============================================================
   Regression test for sign-up promo handling on the client.

   Bug: the API began reporting (AuthResponse.promo) when a promo code
   supplied at sign-up couldn't be redeemed (validate→redeem race), but
   AuthScreen ignored it and just called onDone() — so the user still
   silently landed on free with no signal, exactly the failure the API
   change was meant to surface.

   `promoNotice` is the decision the submit handler acts on: it returns
   the error to notify the user about (→ an Alert), or null when there is
   nothing to surface. These pin that a failed sign-up promo is NOT
   swallowed.
   ============================================================ */

import { Alert } from 'react-native'
import type { AuthResponse } from '@yon/shared'
import { promoNotice, notifyPromo } from '../AuthScreen'

const base: AuthResponse = {
  user: {
    id: 'u1',
    displayName: 'a',
    phone: '',
    email: 'a@x.com',
    avatar: '',
    locale: 'zh',
    plan: 'free',
    warningsEnabled: false,
    locationEnabled: false,
    mediaEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  token: 'tok',
}

describe('promoNotice', () => {
  it('returns the error code when a sign-up promo failed to redeem', () => {
    expect(promoNotice({ ...base, promo: { ok: false, error: 'code_exhausted' } })).toBe('code_exhausted')
    expect(promoNotice({ ...base, promo: { ok: false, error: 'already_redeemed' } })).toBe('already_redeemed')
  })

  it('returns null when the promo code was applied', () => {
    expect(promoNotice({ ...base, promo: { ok: true } })).toBeNull()
  })

  it('returns null for a plain sign-up with no promo code', () => {
    expect(promoNotice(base)).toBeNull()
  })
})

describe('notifyPromo (the side effect submit() runs)', () => {
  const t = (k: string) => k // identity: assert on i18n keys

  let alertSpy: jest.SpyInstance

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  })
  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('alerts with the not-applied message + the specific reason when the promo failed', () => {
    notifyPromo({ ...base, promo: { ok: false, error: 'code_exhausted' } }, t)
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy).toHaveBeenCalledWith('auth_promo_not_applied', 'auth_err_code_exhausted')
  })

  it('does NOT alert when the promo was applied', () => {
    notifyPromo({ ...base, promo: { ok: true } }, t)
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('does NOT alert for a plain sign-up with no promo code', () => {
    notifyPromo(base, t)
    expect(alertSpy).not.toHaveBeenCalled()
  })
})
