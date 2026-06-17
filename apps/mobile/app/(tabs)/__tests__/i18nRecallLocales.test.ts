/* ============================================================
   RED test — i18n patch: es/ja/ko locales must contain the
   RecallView keys that already exist in en.ts and zh.ts:
     recall_today, recall_yesterday, recall_repurchase_badge, recall_empty

   Fails against current code because those keys are absent from
   the es, ja, and ko locale objects.
   ============================================================ */

import { es } from '@yon/shared/i18n/locales/es'
import { ja } from '@yon/shared/i18n/locales/ja'
import { ko } from '@yon/shared/i18n/locales/ko'

const REQUIRED_RECALL_KEYS = [
  'recall_today',
  'recall_yesterday',
  'recall_repurchase_badge',
  'recall_empty',
] as const

describe('i18n recall timeline keys — es/ja/ko completeness', () => {
  it.each([
    ['es', es],
    ['ja', ja],
    ['ko', ko],
  ] as const)('%s has all required recall timeline keys', (_locale, dict) => {
    for (const key of REQUIRED_RECALL_KEYS) {
      expect(dict).toHaveProperty(key)
      expect(typeof (dict as Record<string, string>)[key]).toBe('string')
      expect((dict as Record<string, string>)[key].length).toBeGreaterThan(0)
    }
  })
})
