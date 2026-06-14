/* ============================================================
   Unit test — filterTastesByTaster (issue #104, S3b persona scoping).

   The shared taste cache holds EVERY persona's records (the list fetch carries
   no taster filter). Each surface narrows client-side by the active persona.
   The reported bug was that switching the top persona did not change the list;
   the fix routes the list through this helper. These pin its contract:

   - self default (active null) → own records + legacy null-taster rows, but
     never a family persona's records.
   - a family persona (active id) → exactly that persona's records.
   ============================================================ */

import { filterTastesByTaster } from '../_useTastes'
import type { Taste } from '@yon/shared'

function taste(name: string, tasterId: string | null | undefined): Taste {
  return { id: name, name, tasterId } as unknown as Taste
}

describe('filterTastesByTaster', () => {
  const SELF = 'ts_self'
  const items = [
    taste('mine', SELF),
    taste('legacy', null),
    taste('undef', undefined),
    taste('wife', 'ts_wife'),
    taste('kid', 'ts_kid'),
  ]

  it('self default keeps self-taster + null/undefined rows, drops family rows', () => {
    const out = filterTastesByTaster(items, null, SELF).map((t) => t.name)
    expect(out).toEqual(['mine', 'legacy', 'undef'])
  })

  it('a family persona keeps only its own records', () => {
    const out = filterTastesByTaster(items, 'ts_wife', SELF).map((t) => t.name)
    expect(out).toEqual(['wife'])
  })

  it('self default with an unknown self id shows everything (no own records hidden)', () => {
    // Until useTasters resolves (or if it fails), the self-taster id is unknown.
    // New self records carry a concrete self id, so a null-only filter would hide
    // them — fall back to the permissive pre-S3b behaviour instead.
    const out = filterTastesByTaster(items, null, null).map((t) => t.name)
    expect(out).toEqual(['mine', 'legacy', 'undef', 'wife', 'kid'])
  })

  it('a family persona with no matching records returns empty', () => {
    expect(filterTastesByTaster(items, 'ts_ghost', SELF)).toEqual([])
  })
})
