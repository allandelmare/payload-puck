import { describe, expect, it } from 'vitest'
import { createEditorVersionField } from '../../src/plugin/fields/index.js'

/**
 * `editorVersion` deliberately has no `defaultValue` — a static default would
 * make a migration stamp every legacy page as 'puck'. All detection happens in
 * the beforeValidate hook, so that hook is the thing worth pinning down.
 */
type HookArgs = { value?: unknown; data?: Record<string, unknown>; operation?: string }

function runHook(field: ReturnType<typeof createEditorVersionField>, args: HookArgs) {
  const hooks = (field as { hooks?: { beforeValidate?: Array<(a: HookArgs) => unknown> } }).hooks
  const hook = hooks?.beforeValidate?.[0]
  if (!hook) throw new Error('editorVersion field is missing its beforeValidate hook')
  return hook(args)
}

describe('createEditorVersionField', () => {
  const field = createEditorVersionField()

  it('declares no defaultValue, so detection is never bypassed', () => {
    expect(field).not.toHaveProperty('defaultValue')
  })

  it('keeps an explicitly set value', () => {
    expect(runHook(field, { value: 'legacy', data: { puckData: { content: [{}] } } })).toBe('legacy')
    expect(runHook(field, { value: 'puck', data: { layout: [{}] } })).toBe('puck')
  })

  it('detects legacy when there are blocks but no puck content', () => {
    expect(runHook(field, { data: { layout: [{ blockType: 'hero' }] } })).toBe('legacy')
  })

  it('detects puck when puck content is present', () => {
    expect(runHook(field, { data: { puckData: { content: [{ type: 'Heading' }] } } })).toBe('puck')
  })

  it('prefers puck when a page has both (mid-migration)', () => {
    expect(
      runHook(field, {
        data: { layout: [{ blockType: 'hero' }], puckData: { content: [{ type: 'Heading' }] } },
      })
    ).toBe('puck')
  })

  it('falls back to the default for empty pages', () => {
    expect(runHook(field, { data: {} })).toBe('puck')
    expect(runHook(field, { data: { layout: [], puckData: { content: [] } } })).toBe('puck')
    expect(runHook(field, {})).toBe('puck')
  })

  it('honours a configured non-default fallback', () => {
    expect(runHook(createEditorVersionField('legacy'), { data: {} })).toBe('legacy')
  })

  it('respects a custom legacy blocks field name', () => {
    const custom = createEditorVersionField('puck', true, 'blocks')
    expect(runHook(custom, { data: { blocks: [{ blockType: 'hero' }] } })).toBe('legacy')
    // The default field name must no longer be consulted.
    expect(runHook(custom, { data: { layout: [{ blockType: 'hero' }] } })).toBe('puck')
  })

  it('is not fooled by malformed content values', () => {
    expect(runHook(field, { data: { layout: 'not-an-array' } })).toBe('puck')
    expect(runHook(field, { data: { puckData: { content: 'not-an-array' } } })).toBe('puck')
    expect(runHook(field, { data: { puckData: null } })).toBe('puck')
  })

  it('places itself in the sidebar by default and honours the opt-out', () => {
    expect(field.admin?.position).toBe('sidebar')
    expect(createEditorVersionField('puck', false).admin?.position).toBeUndefined()
  })
})
