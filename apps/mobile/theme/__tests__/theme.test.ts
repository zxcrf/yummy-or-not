/**
 * B1 theme foundation tests.
 *
 * § 6 prescribes tests that pin:
 *   - color alias completeness (no undefined / token-string leakage)
 *   - textBase baseline values matching Tamagui's createFont defaults
 *   - space/radius numeric constants
 *   - motion preset shapes
 */

import { colors } from '../colors'
import { space as spaceNs, radius, borderWidths, zIndex } from '../space'
import { textBase, fontSize, lineHeight, fontWeight } from '../type'
import { popShadow, pressedShadow } from '../shadows'
import { bouncy, quick, lazy, t100, t200 } from '../motion'

// ---------- Color alias completeness ----------

describe('colors — raw palette', () => {
  it('exports ink900 as correct hex', () => {
    expect(colors.ink900).toBe('#191017')
  })
  it('exports candyPink as brand primary', () => {
    expect(colors.candyPink).toBe('#ff2e88')
  })
  it('exports candyBlue', () => {
    expect(colors.candyBlue).toBe('#2f6bff')
  })
  it('exports verdictYum', () => {
    expect(colors.verdictYum).toBe('#14c46b')
  })
  it('exports verdictMeh', () => {
    expect(colors.verdictMeh).toBe('#ffb20e')
  })
  it('exports verdictNah', () => {
    expect(colors.verdictNah).toBe('#ff3147')
  })
})

describe('colors — semantic token-group aliases', () => {
  it('brand resolves to candyPink', () => {
    expect(colors.brand).toBe('#ff2e88')
  })
  it('brandDeep resolves to candyPinkDeep', () => {
    expect(colors.brandDeep).toBe('#d6005f')
  })
  it('focusRing resolves to candyBlue', () => {
    expect(colors.focusRing).toBe('#2f6bff')
  })
})

describe('colors — full yum-theme alias map', () => {
  it('background = paper (#fff6e6)', () => {
    expect(colors.background).toBe('#fff6e6')
  })
  it('backgroundHover = paper2 (#ffeecf)', () => {
    expect(colors.backgroundHover).toBe('#ffeecf')
  })
  it('backgroundPress = paper3 (#ffe6b8)', () => {
    expect(colors.backgroundPress).toBe('#ffe6b8')
  })
  it('backgroundFocus = paper2 (#ffeecf)', () => {
    expect(colors.backgroundFocus).toBe('#ffeecf')
  })
  it('backgroundStrong = white (#ffffff)', () => {
    expect(colors.backgroundStrong).toBe('#ffffff')
  })
  it('backgroundTransparent is rgba string', () => {
    expect(colors.backgroundTransparent).toBe('rgba(255,246,230,0)')
  })
  it('color = ink900 (#191017)', () => {
    expect(colors.color).toBe('#191017')
  })
  it('colorHover = ink700 (#3a2c36)', () => {
    expect(colors.colorHover).toBe('#3a2c36')
  })
  it('colorTransparent is rgba string', () => {
    expect(colors.colorTransparent).toBe('rgba(25,16,23,0)')
  })
  it('colorMuted = ink500 (#6b5b65)', () => {
    expect(colors.colorMuted).toBe('#6b5b65')
  })
  it('colorFaint = ink400 (#8f8189)', () => {
    expect(colors.colorFaint).toBe('#8f8189')
  })
  it('borderColor = ink900', () => {
    expect(colors.borderColor).toBe('#191017')
  })
  it('borderColorFocus = candyBlue (#2f6bff)', () => {
    expect(colors.borderColorFocus).toBe('#2f6bff')
  })
  it('borderColorSoft = ink200 (#ddd6da)', () => {
    expect(colors.borderColorSoft).toBe('#ddd6da')
  })
  it('success = verdictYum (#14c46b)', () => {
    expect(colors.success).toBe('#14c46b')
  })
  it('warning = verdictMeh (#ffb20e)', () => {
    expect(colors.warning).toBe('#ffb20e')
  })
  it('danger = verdictNah (#ff3147)', () => {
    expect(colors.danger).toBe('#ff3147')
  })
  it('info = candyBlue (#2f6bff)', () => {
    expect(colors.info).toBe('#2f6bff')
  })
  it('shadowColor = ink900', () => {
    expect(colors.shadowColor).toBe('#191017')
  })
  it('accent = candyPink (#ff2e88)', () => {
    expect(colors.accent).toBe('#ff2e88')
  })
})

// ---------- Space / radius ----------

describe('space', () => {
  it('space[1] = 4', () => { expect(spaceNs[1]).toBe(4) })
  it('space[2] = 8', () => { expect(spaceNs[2]).toBe(8) })
  it('space[4] = 16 (default)', () => { expect(spaceNs[4]).toBe(16) })
  it('space[7] = 32', () => { expect(spaceNs[7]).toBe(32) })
  it('space[12] = 96', () => { expect(spaceNs[12]).toBe(96) })
  it('space.true = 16', () => { expect(spaceNs.true).toBe(16) })
})

describe('radius', () => {
  it('radius.xs = 4', () => { expect(radius.xs).toBe(4) })
  it('radius.sm = 6', () => { expect(radius.sm).toBe(6) })
  it('radius.md = 10', () => { expect(radius.md).toBe(10) })
  it('radius.lg = 16', () => { expect(radius.lg).toBe(16) })
  it('radius.xl = 22', () => { expect(radius.xl).toBe(22) })
  it('radius.pill = 999', () => { expect(radius.pill).toBe(999) })
  it('radius.true is defined and a valid number (Tamagui compat, maps to md=10)', () => {
    expect(typeof (radius as Record<string, unknown>).true).toBe('number')
    expect((radius as Record<string, unknown>).true).toBe(10)
  })
})

describe('borderWidths', () => {
  it('thin = 2, base = 3, thick = 4', () => {
    expect(borderWidths.thin).toBe(2)
    expect(borderWidths.base).toBe(3)
    expect(borderWidths.thick).toBe(4)
  })
})

describe('zIndex', () => {
  it('overlay = 1000, toast = 2000', () => {
    expect(zIndex.overlay).toBe(1000)
    expect(zIndex.toast).toBe(2000)
  })
  it('zIndex[0] = 0 (Tamagui compat)', () => {
    expect((zIndex as Record<string | number, unknown>)[0]).toBe(0)
  })
  it('zIndex.true is defined and maps to base=1 (Tamagui compat)', () => {
    expect(typeof (zIndex as Record<string, unknown>).true).toBe('number')
    expect((zIndex as Record<string, unknown>).true).toBe(1)
  })
})

// ---------- Typography / textBase ----------

describe('textBase', () => {
  it('color is concrete hex #191017 (not a token string)', () => {
    expect(textBase.color).toBe('#191017')
    expect(textBase.color).not.toContain('$')
  })
  it('fontSize = 16 (size 5)', () => {
    expect(textBase.fontSize).toBe(16)
  })
  it('lineHeight = 23 (lineHeight 5)', () => {
    expect(textBase.lineHeight).toBe(23)
  })
  it('fontWeight = 400', () => {
    expect(textBase.fontWeight).toBe('400')
  })
})

describe('fontSize scale', () => {
  it('index 1 = 10, 5 = 16, 12 = 84', () => {
    expect(fontSize[1]).toBe(10)
    expect(fontSize[5]).toBe(16)
    expect(fontSize[12]).toBe(84)
  })
})

describe('lineHeight scale', () => {
  it('index 5 = 23', () => {
    expect(lineHeight[5]).toBe(23)
  })
})

describe('fontWeight map', () => {
  it('key 4 = 400, key 7 = 700', () => {
    expect(fontWeight[4]).toBe('400')
    expect(fontWeight[7]).toBe('700')
  })
})

// ---------- Shadows ----------

describe('popShadow', () => {
  it('sm has correct offset and no blur', () => {
    expect(popShadow.sm.shadowOffset).toEqual({ width: 3, height: 3 })
    expect(popShadow.sm.shadowRadius).toBe(0)
    expect(popShadow.sm.shadowOpacity).toBe(1)
    expect(popShadow.sm.shadowColor).toBe('#191017')
  })
  it('md has offset 5x5', () => {
    expect(popShadow.md.shadowOffset).toEqual({ width: 5, height: 5 })
  })
  it('pink uses candyPink shadow color', () => {
    expect(popShadow.pink.shadowColor).toBe('#ff2e88')
  })
  it('blue uses candyBlue shadow color', () => {
    expect(popShadow.blue.shadowColor).toBe('#2f6bff')
  })
})

describe('pressedShadow', () => {
  it('button collapsed shadow has 0x0 offset', () => {
    expect(pressedShadow.button.shadowOffset).toEqual({ width: 0, height: 0 })
  })
  it('card pressed shadow collapses to 3x3 (5x5 → 3x3 per spec)', () => {
    expect(pressedShadow.card.shadowOffset).toEqual({ width: 3, height: 3 })
  })
})

// ---------- Motion presets ----------

describe('motion presets', () => {
  it('bouncy: damping 9, stiffness 150, mass 0.9', () => {
    expect(bouncy).toEqual({ damping: 9, stiffness: 150, mass: 0.9 })
  })
  it('quick: damping 20, stiffness 250', () => {
    expect(quick).toEqual({ damping: 20, stiffness: 250 })
  })
  it('lazy: damping 15, stiffness 100', () => {
    expect(lazy).toEqual({ damping: 15, stiffness: 100 })
  })
  it('t100: duration 100', () => {
    expect(t100).toEqual({ duration: 100 })
  })
  it('t200: duration 200', () => {
    expect(t200).toEqual({ duration: 200 })
  })
})
