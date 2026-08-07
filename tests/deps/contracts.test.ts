import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import parse from 'html-react-parser'
import * as lucide from 'lucide-react'

/**
 * Contract tests for the two runtime dependencies whose *major* versions can
 * break rendering silently rather than loudly.
 *
 * A renamed Lucide export or a changed `parse()` return shape produces a broken
 * page, not a type error — `lucide-react` re-exports a huge namespace and
 * `parse()` is typed loosely enough that a behavioural change slips through
 * `tsc`. These assert the behaviour we actually depend on.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

/** Every identifier imported from lucide-react anywhere in src/. */
function importedLucideIcons(): string[] {
  const names = new Set<string>()
  for (const file of walk('src')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'lucide-react'/g)) {
      for (const raw of match[1].split(',')) {
        const spec = raw.trim()
        if (!spec) continue
        // `Subscript as SubscriptIcon` -> the imported name is `Subscript`.
        names.add(spec.split(/\s+as\s+/)[0].trim())
      }
    }
  }
  return [...names].sort()
}

describe('lucide-react', () => {
  const icons = importedLucideIcons()

  it('finds the icon imports to check (guards the scanner itself)', () => {
    // If the scan silently returned nothing, the assertion below would pass
    // vacuously and this suite would be worthless.
    expect(icons.length).toBeGreaterThan(20)
  })

  it('still exports every icon src/ imports', () => {
    const missing = icons.filter((name) => !(name in lucide))
    expect(missing).toEqual([])
  })

  it('exports icons as renderable components', () => {
    // Icons are forwardRef components (objects), not plain functions, so they
    // must go through createElement rather than being called directly.
    const html = renderToStaticMarkup(createElement(lucide.Check, { size: 16 }))
    expect(html).toContain('<svg')
    expect(html).toContain('width="16"')
  })
})

describe('html-react-parser', () => {
  // RichText.server calls `parse(content)` on an HTML string with no options.
  it('turns an HTML string into renderable React elements', () => {
    const html = renderToStaticMarkup(parse('<p>Hello <strong>world</strong></p>') as never)
    expect(html).toBe('<p>Hello <strong>world</strong></p>')
  })

  it('preserves nested markup and attributes used by rich text', () => {
    const html = renderToStaticMarkup(
      parse('<h2 id="t">Title</h2><ul><li><a href="/x">link</a></li></ul>') as never
    )
    expect(html).toContain('<h2 id="t">Title</h2>')
    expect(html).toContain('<a href="/x">link</a>')
  })

  it('converts inline style strings into React style objects', () => {
    // style-to-js is a transitive dep that changed major versions in the v6 line.
    const html = renderToStaticMarkup(parse('<p style="text-align:center">x</p>') as never)
    expect(html).toContain('text-align:center')
  })

  it('returns an empty result for an empty string rather than throwing', () => {
    expect(() => parse('')).not.toThrow()
  })
})
