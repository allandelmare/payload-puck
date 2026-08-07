import { describe, expect, it } from 'vitest'
import {
  backgroundValueToEmailCSS,
  colorValueToCSS,
  colorValueToEmailCSS,
  marginValueToCSS,
  paddingValueToCSS,
  paddingValueToEmailCSS,
} from '../../src/fields/shared.js'

/**
 * The field-value → CSS converters are pure functions that every component's
 * render path depends on, and their shorthand collapsing / email fallbacks are
 * exactly the kind of logic that silently produces wrong output.
 */
describe('colorValueToCSS', () => {
  it('returns undefined for absent or hex-less input', () => {
    expect(colorValueToCSS(null)).toBeUndefined()
    expect(colorValueToCSS(undefined)).toBeUndefined()
    expect(colorValueToCSS({ hex: '' })).toBeUndefined()
  })

  it('returns the bare hex at full opacity', () => {
    expect(colorValueToCSS({ hex: '#ff0000' })).toBe('#ff0000')
    expect(colorValueToCSS({ hex: '#ff0000', opacity: 100 })).toBe('#ff0000')
  })

  it('emits rgba below full opacity', () => {
    expect(colorValueToCSS({ hex: '#ff0000', opacity: 50 })).toBe('rgba(255, 0, 0, 0.5)')
    expect(colorValueToCSS({ hex: '#000000', opacity: 0 })).toBe('rgba(0, 0, 0, 0)')
  })

  it('falls back to the raw value when the hex is unparseable', () => {
    // Shorthand hex is not expanded, so it cannot be given an alpha channel.
    expect(colorValueToCSS({ hex: '#f00', opacity: 50 })).toBe('#f00')
  })
})

describe('paddingValueToCSS', () => {
  it('returns undefined when unset', () => {
    expect(paddingValueToCSS(null)).toBeUndefined()
    expect(paddingValueToCSS(undefined)).toBeUndefined()
  })

  it('collapses four equal sides to one value', () => {
    expect(paddingValueToCSS({ top: 8, right: 8, bottom: 8, left: 8, unit: 'px' })).toBe('8px')
  })

  it('collapses matching axes to two values', () => {
    expect(paddingValueToCSS({ top: 8, right: 16, bottom: 8, left: 16, unit: 'px' })).toBe(
      '8px 16px'
    )
  })

  it('collapses matching horizontal sides to three values', () => {
    expect(paddingValueToCSS({ top: 4, right: 16, bottom: 8, left: 16, unit: 'px' })).toBe(
      '4px 16px 8px'
    )
  })

  it('emits all four values when nothing matches', () => {
    expect(paddingValueToCSS({ top: 1, right: 2, bottom: 3, left: 4, unit: 'rem' })).toBe(
      '1rem 2rem 3rem 4rem'
    )
  })

  it('preserves the configured unit', () => {
    expect(paddingValueToCSS({ top: 2, right: 2, bottom: 2, left: 2, unit: 'rem' })).toBe('2rem')
  })

  it('keeps zero values rather than dropping them', () => {
    expect(paddingValueToCSS({ top: 0, right: 0, bottom: 0, left: 0, unit: 'px' })).toBe('0px')
  })
})

describe('marginValueToCSS', () => {
  it('collapses the same way padding does', () => {
    expect(marginValueToCSS({ top: 8, right: 8, bottom: 8, left: 8, unit: 'px' })).toBe('8px')
    expect(marginValueToCSS({ top: 1, right: 2, bottom: 3, left: 4, unit: 'px' })).toBe(
      '1px 2px 3px 4px'
    )
  })
})

describe('email converters', () => {
  it('always returns hex, never rgba (email clients lack rgba support)', () => {
    expect(colorValueToEmailCSS({ hex: '#ff0000' })).toBe('#ff0000')
    const half = colorValueToEmailCSS({ hex: '#ff0000', opacity: 50 })
    expect(half).toMatch(/^#[0-9a-f]{6}$/)
    expect(half).not.toContain('rgba')
  })

  it('blends opacity toward white', () => {
    // 50% of #000000 over white lands on mid grey.
    expect(colorValueToEmailCSS({ hex: '#000000', opacity: 50 })).toBe('#808080')
    expect(colorValueToEmailCSS({ hex: '#000000', opacity: 0 })).toBe('#ffffff')
  })

  it('forces px units regardless of the configured unit', () => {
    expect(paddingValueToEmailCSS({ top: 2, right: 2, bottom: 2, left: 2, unit: 'rem' })).toBe('2px')
    expect(paddingValueToEmailCSS({ top: 1, right: 2, bottom: 3, left: 4, unit: 'rem' })).toBe(
      '1px 2px 3px 4px'
    )
  })

  it('reduces a gradient background to its first stop', () => {
    expect(
      backgroundValueToEmailCSS({
        type: 'gradient',
        gradient: {
          type: 'linear',
          angle: 90,
          stops: [
            { color: { hex: '#ff0000' }, position: 0 },
            { color: { hex: '#0000ff' }, position: 100 },
          ],
        },
      })
    ).toEqual({ backgroundColor: '#ff0000' })
  })

  it('emits nothing for none/absent backgrounds', () => {
    expect(backgroundValueToEmailCSS({ type: 'none' })).toEqual({})
    expect(backgroundValueToEmailCSS(null)).toEqual({})
  })
})
