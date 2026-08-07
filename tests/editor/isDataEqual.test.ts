import { describe, expect, it } from 'vitest'
import { isDataEqual } from '../../src/editor/utils/isDataEqual.js'

/**
 * `isDataEqual` is what stops the editor flipping to "Unsaved" on load: Puck's
 * mount-time resolve pass dispatches a no-op change whose only difference from
 * the loaded data is `undefined`-valued keys. These tests pin down both halves
 * of that contract — the undefined tolerance that makes the no-op compare
 * equal, and the strictness that keeps real edits detectable.
 */
describe('isDataEqual', () => {
  describe('undefined tolerance (the reason this exists)', () => {
    it('treats a missing key and an undefined-valued key as equal', () => {
      expect(isDataEqual({}, { k: undefined })).toBe(true)
      expect(isDataEqual({ k: undefined }, {})).toBe(true)
    })

    it('tolerates undefined-valued keys nested inside component props', () => {
      const loaded = { content: [{ type: 'Heading', props: { id: 'a', text: 'Hi' } }] }
      const resolved = {
        content: [{ type: 'Heading', props: { id: 'a', text: 'Hi', align: undefined } }],
      }
      expect(isDataEqual(loaded, resolved)).toBe(true)
    })

    it('does not conflate undefined with null', () => {
      expect(isDataEqual({ k: undefined }, { k: null })).toBe(false)
      expect(isDataEqual({}, { k: null })).toBe(false)
    })

    it('does not conflate undefined with other falsy values', () => {
      expect(isDataEqual({}, { k: 0 })).toBe(false)
      expect(isDataEqual({}, { k: '' })).toBe(false)
      expect(isDataEqual({}, { k: false })).toBe(false)
    })
  })

  describe('object comparison', () => {
    it('ignores key order', () => {
      expect(isDataEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    })

    it('detects a changed value', () => {
      expect(isDataEqual({ a: 1 }, { a: 2 })).toBe(false)
    })

    it('detects an added key with a defined value', () => {
      expect(isDataEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    })

    it('compares deeply nested structures', () => {
      expect(isDataEqual({ a: { b: { c: [1, 2] } } }, { a: { b: { c: [1, 2] } } })).toBe(true)
      expect(isDataEqual({ a: { b: { c: [1, 2] } } }, { a: { b: { c: [1, 3] } } })).toBe(false)
    })
  })

  describe('array comparison', () => {
    it('is order-sensitive (Puck content order is meaningful)', () => {
      expect(isDataEqual([1, 2], [2, 1])).toBe(false)
    })

    it('detects length changes', () => {
      expect(isDataEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('never treats an array as equal to a plain object', () => {
      expect(isDataEqual([], {})).toBe(false)
      expect(isDataEqual({}, [])).toBe(false)
      // An array and an object with matching index keys are still different shapes.
      expect(isDataEqual(['a'], { 0: 'a' })).toBe(false)
    })
  })

  describe('primitives', () => {
    it('compares equal primitives', () => {
      expect(isDataEqual('a', 'a')).toBe(true)
      expect(isDataEqual(1, 1)).toBe(true)
      expect(isDataEqual(true, true)).toBe(true)
      expect(isDataEqual(null, null)).toBe(true)
      expect(isDataEqual(undefined, undefined)).toBe(true)
    })

    it('treats NaN as equal to itself', () => {
      expect(isDataEqual(NaN, NaN)).toBe(true)
    })

    it('distinguishes differing primitives and mismatched types', () => {
      expect(isDataEqual('a', 'b')).toBe(false)
      expect(isDataEqual(1, '1')).toBe(false)
      expect(isDataEqual(null, {})).toBe(false)
      expect(isDataEqual({}, null)).toBe(false)
    })
  })

  describe('realistic Puck payloads', () => {
    const loaded = {
      root: { props: { title: 'Home', slug: 'home' } },
      content: [
        { type: 'Heading', props: { id: 'h1', text: 'Welcome', level: 'h1' } },
        { type: 'Text', props: { id: 't1', text: 'Body copy' } },
      ],
      zones: {},
    }

    it('reports a no-op mount resolve as unchanged', () => {
      const afterResolve = {
        root: { props: { title: 'Home', slug: 'home', pageLayout: undefined } },
        content: [
          { type: 'Heading', props: { id: 'h1', text: 'Welcome', level: 'h1', align: undefined } },
          { type: 'Text', props: { id: 't1', text: 'Body copy' } },
        ],
        zones: {},
      }
      expect(isDataEqual(loaded, afterResolve)).toBe(true)
    })

    it('reports a genuine text edit as changed', () => {
      const edited = structuredClone(loaded)
      edited.content[0].props.text = 'Welcome!'
      expect(isDataEqual(loaded, edited)).toBe(false)
    })

    it('reports a removed component as changed', () => {
      const edited = { ...loaded, content: [loaded.content[0]] }
      expect(isDataEqual(loaded, edited)).toBe(false)
    })

    it('reports reordered components as changed', () => {
      const edited = { ...loaded, content: [loaded.content[1], loaded.content[0]] }
      expect(isDataEqual(loaded, edited)).toBe(false)
    })

    it('short-circuits on reference-equal subtrees', () => {
      // Puck updates immutably, so unchanged branches keep identity. This is what
      // keeps the per-keystroke cost proportional to the edited path, not the tree.
      expect(isDataEqual(loaded, { ...loaded })).toBe(true)
    })
  })
})
