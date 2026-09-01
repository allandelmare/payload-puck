/**
 * Static guard for the access-control invariant.
 *
 * The behavioural tests in `accessControl.test.ts` only cover sinks that a test
 * actually drives. This file covers every Payload Local API call that *exists*
 * in the source, so a newly added sink fails immediately rather than waiting for
 * someone to notice the missing coverage. That is the failure mode that produced
 * GHSA-957g-hmmp-rchg: the 0.6.23 fix guarded `src/endpoints/index.ts` and left
 * eleven identical sinks in `src/api/` untouched for five releases.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))

/** Local API operations that evaluate access control. */
const SINK_OPS = [
  'find',
  'findByID',
  'findVersions',
  'create',
  'update',
  'delete',
  'restoreVersion',
] as const

/** Files that route external HTTP requests into the Local API. */
const GUARDED_FILES = [
  'api/createPuckApiRoutes.ts',
  'api/createPuckApiRoutesWithId.ts',
  'api/createPuckApiRoutesVersions.ts',
  'endpoints/index.ts',
  'endpoints/context.ts',
  'endpoints/prompts.ts',
  'ai/plugins/promptApiRoutes.ts',
  'ai/tools/index.ts',
]

/**
 * Remove comments so JSDoc examples (which legitimately show `payload.find({...})`
 * with `overrideAccess: true` for the trusted user-mapping lookup) are not
 * mistaken for real sinks.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

/** Extract the argument text of a call, by balancing brackets from its open paren. */
function argumentText(source: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return source.slice(openParen + 1, i)
    }
  }
  return source.slice(openParen + 1)
}

type Sink = { file: string; op: string; args: string; line: number }

function findSinks(file: string): Sink[] {
  const raw = readFileSync(join(SRC, file), 'utf8')
  const source = stripComments(raw)
  const pattern = new RegExp(`\\b(?:req\\.)?payload\\.(${SINK_OPS.join('|')})\\s*\\(`, 'g')
  const sinks: Sink[] = []

  for (const match of source.matchAll(pattern)) {
    const openParen = match.index! + match[0].length - 1
    sinks.push({
      file,
      op: match[1],
      args: argumentText(source, openParen),
      line: source.slice(0, match.index!).split('\n').length,
    })
  }
  return sinks
}

/**
 * True when a sink's arguments enforce access control — either inline, or via a
 * spread/identifier whose declaration in the same file does.
 */
function isGuarded(sink: Sink, fileSource: string): boolean {
  const args = sink.args.trim()

  if (/overrideAccess\s*:/.test(args) || /\.\.\.access\b/.test(args)) return true

  // Indirect call: `payload.update(updateOptions)`. Resolve the declaration.
  const identifier = /^[A-Za-z_$][\w$]*$/.exec(args)?.[0]
  if (identifier) {
    const declaration = new RegExp(`const ${identifier}[^=]*=\\s*\\{`).exec(fileSource)
    if (declaration) {
      const block = argumentText(fileSource, declaration.index + declaration[0].length - 1)
      return /overrideAccess\s*:/.test(block) || /\.\.\.access\b/.test(block)
    }
  }

  return false
}

describe('access-control invariant across all request-facing sources', () => {
  const allSinks = GUARDED_FILES.flatMap(findSinks)

  it('finds the sinks it is meant to be guarding', () => {
    // A refactor that renames or relocates these files must not silently reduce
    // this suite to asserting nothing.
    expect(allSinks.length).toBeGreaterThanOrEqual(26)
    for (const file of GUARDED_FILES) {
      expect(allSinks.some((s) => s.file === file)).toBe(true)
    }
  })

  it.each(GUARDED_FILES)('%s enforces access control on every sink', (file) => {
    const source = stripComments(readFileSync(join(SRC, file), 'utf8'))
    const unguarded = findSinks(file)
      .filter((sink) => !isGuarded(sink, source))
      .map((sink) => `${sink.file}:${sink.line} payload.${sink.op}()`)

    expect(unguarded).toEqual([])
  })

  it('has no unguarded sink anywhere in the request path', () => {
    // Catches a sink added to a *new* file in any of these directories, which the
    // explicit file list above would otherwise miss. This is the assertion that
    // found the fourth route factory (ai/plugins/promptApiRoutes.ts) and the
    // AI tool reads, neither of which any advisory named.
    const discovered: string[] = []
    for (const dir of ['api', 'endpoints', 'ai', 'plugin']) {
      const walk = (rel: string) => {
        for (const entry of readdirSync(join(SRC, rel), { withFileTypes: true })) {
          const next = `${rel}/${entry.name}`
          if (entry.isDirectory()) walk(next)
          else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            discovered.push(next)
          }
        }
      }
      walk(dir)
    }

    const unguarded = discovered.flatMap((file) => {
      const source = stripComments(readFileSync(join(SRC, file), 'utf8'))
      return findSinks(file)
        .filter((sink) => !isGuarded(sink, source))
        .map((sink) => `${sink.file}:${sink.line} payload.${sink.op}()`)
    })

    expect(unguarded).toEqual([])
  })
})
