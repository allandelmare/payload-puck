/**
 * Undefined-tolerant deep equality for Puck data.
 *
 * Puck's mount-time resolve pass (`resolveAndCommitData`) can dispatch a `replace`
 * even when the net content is unchanged — e.g. a resolved node differs from the
 * loaded node only by an `undefined`-valued key. Strict deep-equal libraries such
 * as `fast-equals` treat `{}` and `{ k: undefined }` as different, so that no-op
 * resolve looks like a real edit and spuriously marks the document dirty.
 *
 * This comparison treats an absent key and an `undefined`-valued key as equal, so
 * a resolve that only adds/removes `undefined` values compares equal to the loaded
 * data. Object key order is irrelevant (as with any deep equal); array order is
 * significant (Puck content order is meaningful).
 */
export function isDataEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }

  // NaN is handled by Object.is above; remaining primitives that differ are unequal.
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }

  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray !== bIsArray) {
    return false
  }

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) {
      return false
    }
    for (let i = 0; i < a.length; i++) {
      if (!isDataEqual(a[i], b[i])) {
        return false
      }
    }
    return true
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>

  // Compare the union of keys, treating a missing key and an `undefined` value as
  // equivalent so that `{}` and `{ k: undefined }` are considered equal.
  const keys = new Set<string>([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const key of keys) {
    const aVal = aObj[key]
    const bVal = bObj[key]
    if (aVal === undefined && bVal === undefined) {
      continue
    }
    if (!isDataEqual(aVal, bVal)) {
      return false
    }
  }
  return true
}
