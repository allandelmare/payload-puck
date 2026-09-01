/**
 * Regression tests for GHSA-957g-hmmp-rchg.
 *
 * The route factories in `src/api/` hold a `Payload` instance rather than a
 * `PayloadRequest`, so they must opt in to access control explicitly on every
 * Local API call. They previously did not, and Payload's `overrideAccess: true`
 * default meant collection access rules were never evaluated.
 *
 * The load-bearing assertion in this file is simple and blunt: drive every
 * handler, capture every Local API call, and require that each one carries
 * `overrideAccess: false` and the resolved Payload user. A new sink added
 * without access arguments fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Forbidden } from 'payload'

vi.mock('payload', async (importOriginal) => {
  // Keep the real module: `APIError`/`Forbidden` identity matters to the error
  // mapper under test, and mocking them away would make these tests prove nothing.
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: vi.fn() }
})

const { getPayload } = await import('payload')
const { createPuckApiRoutes } = await import('../../src/api/createPuckApiRoutes.js')
const { createPuckApiRoutesWithId } = await import('../../src/api/createPuckApiRoutesWithId.js')
const { createPuckApiRoutesVersions } = await import('../../src/api/createPuckApiRoutesVersions.js')
const { isPayloadUser, resolvePayloadUser, PuckApiAccessError } = await import(
  '../../src/api/utils/access.js'
)

import type { AuthResult, PuckApiRoutesConfig } from '../../src/api/types.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Payload user document — note `collection`, which is what makes it one. */
const PAYLOAD_USER = { id: 'u1', collection: 'users', role: 'editor' }

/** A Better Auth / NextAuth style session user. Deliberately has no `collection`. */
const SESSION_USER = { id: 'sess-1', email: 'editor@example.com' }

type RecordedCall = { op: string; args: Record<string, unknown> }

function mockPayload(overrides: Record<string, unknown> = {}) {
  const calls: RecordedCall[] = []

  const returns: Record<string, unknown> = {
    find: { docs: [], totalDocs: 0 },
    findByID: { id: 'p1' },
    create: { id: 'new' },
    update: { id: 'p1' },
    delete: { id: 'p1' },
    findVersions: {
      docs: [],
      totalDocs: 0,
      totalPages: 0,
      page: 1,
      limit: 20,
      hasPrevPage: false,
      hasNextPage: false,
    },
    restoreVersion: { id: 'p1' },
    ...overrides,
  }

  const op = (name: string) =>
    vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ op: name, args })
      const value = returns[name]
      if (value instanceof Error) throw value
      if (typeof value === 'function') return (value as (a: unknown) => unknown)(args)
      return value
    })

  const payload = {
    find: op('find'),
    findByID: op('findByID'),
    create: op('create'),
    update: op('update'),
    delete: op('delete'),
    findVersions: op('findVersions'),
    restoreVersion: op('restoreVersion'),
  }

  vi.mocked(getPayload).mockResolvedValue(payload as never)
  return { calls, payload }
}

function baseConfig(auth: Partial<PuckApiRoutesConfig['auth']> = {}): PuckApiRoutesConfig {
  return {
    collection: 'pages',
    payloadConfig: Promise.resolve({} as never),
    auth: {
      authenticate: async (): Promise<AuthResult> => ({
        authenticated: true,
        user: PAYLOAD_USER,
      }),
      ...auth,
    } as PuckApiRoutesConfig['auth'],
  }
}

const req = (url = 'http://localhost/api/puck/pages', init?: RequestInit) =>
  new NextRequest(url, init as never)

const ctx = (id = 'p1') => ({ params: Promise.resolve({ id }) })

const jsonReq = (body: unknown, url = 'http://localhost/api/puck/pages') =>
  req(url, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// The invariant: every sink is access-controlled
// ---------------------------------------------------------------------------

describe('every Payload Local API call is access-controlled', () => {
  /**
   * Drives all eight handlers across the three factories and returns every
   * recorded Local API call. Exercising them together is what makes this a
   * coverage assertion rather than eight independent spot checks.
   */
  async function driveAllHandlers() {
    const { calls } = mockPayload()
    const config = baseConfig()

    const list = createPuckApiRoutes(config)
    await list.GET(req(), { params: Promise.resolve({}) })
    await list.POST(jsonReq({ title: 'T', slug: 't' }), { params: Promise.resolve({}) })

    const byId = createPuckApiRoutesWithId(config)
    await byId.GET(req('http://localhost/api/puck/pages/p1'), ctx())
    await byId.PATCH(
      jsonReq(
        { puckData: { root: { props: {} }, content: [], zones: {} }, swapHomepage: true, isHomepage: true },
        'http://localhost/api/puck/pages/p1'
      ),
      ctx()
    )
    await byId.DELETE(req('http://localhost/api/puck/pages/p1'), ctx())

    const versions = createPuckApiRoutesVersions(config)
    await versions.GET(req('http://localhost/api/puck/pages/p1/versions'), ctx())
    await versions.POST(
      jsonReq({ versionId: 'v1' }, 'http://localhost/api/puck/pages/p1/versions'),
      ctx()
    )

    return calls
  }

  it('reaches every sink the advisory named', async () => {
    const calls = await driveAllHandlers()
    const ops = calls.map((c) => c.op)

    // The homepage-swap branch contributes the second find and the extra update.
    expect(ops).toEqual(
      expect.arrayContaining([
        'find',
        'create',
        'findByID',
        'update',
        'delete',
        'findVersions',
        'restoreVersion',
      ])
    )
    expect(calls.length).toBeGreaterThanOrEqual(9)
  })

  it('passes overrideAccess:false on every single call', async () => {
    const calls = await driveAllHandlers()

    const unguarded = calls.filter((c) => c.args.overrideAccess !== false)
    expect(
      unguarded.map((c) => `${c.op}(overrideAccess=${String(c.args.overrideAccess)})`)
    ).toEqual([])
  })

  it('passes the resolved Payload user on every single call', async () => {
    const calls = await driveAllHandlers()

    const missingUser = calls.filter((c) => c.args.user !== PAYLOAD_USER)
    expect(missingUser.map((c) => c.op)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Resolving which Payload user to act as
// ---------------------------------------------------------------------------

describe('isPayloadUser', () => {
  it('accepts a Payload user document', () => {
    expect(isPayloadUser(PAYLOAD_USER)).toBe(true)
    expect(isPayloadUser({ id: 7, collection: 'admins' })).toBe(true)
  })

  it('rejects an external session user, which has no collection', () => {
    expect(isPayloadUser(SESSION_USER)).toBe(false)
  })

  it('rejects non-objects and malformed shapes', () => {
    expect(isPayloadUser(null)).toBe(false)
    expect(isPayloadUser(undefined)).toBe(false)
    expect(isPayloadUser('u1')).toBe(false)
    expect(isPayloadUser({ collection: 'users' })).toBe(false)
    expect(isPayloadUser({ id: 'u1' })).toBe(false)
    expect(isPayloadUser({ id: {}, collection: 'users' })).toBe(false)
    expect(isPayloadUser({ id: 'u1', collection: 123 })).toBe(false)
  })
})

describe('resolvePayloadUser', () => {
  const authResult = (over: Partial<AuthResult> = {}): AuthResult => ({
    authenticated: true,
    user: SESSION_USER,
    ...over,
  })

  it('prefers the explicit toPayloadUser hook', async () => {
    const mapped = { id: 'u9', collection: 'users' }
    const auth = {
      authenticate: async () => authResult(),
      toPayloadUser: vi.fn(async () => mapped),
    }
    await expect(resolvePayloadUser(auth as never, authResult(), req())).resolves.toBe(mapped)
    expect(auth.toPayloadUser).toHaveBeenCalledOnce()
  })

  it('honours toPayloadUser returning null as "act anonymously"', async () => {
    const auth = { authenticate: async () => authResult(), toPayloadUser: () => null }
    await expect(resolvePayloadUser(auth as never, authResult(), req())).resolves.toBeNull()
  })

  it('uses authResult.payloadUser when the hook is absent', async () => {
    const auth = { authenticate: async () => authResult() }
    await expect(
      resolvePayloadUser(auth as never, authResult({ payloadUser: PAYLOAD_USER }), req())
    ).resolves.toBe(PAYLOAD_USER)
  })

  it('honours an explicit null payloadUser', async () => {
    const auth = { authenticate: async () => authResult() }
    await expect(
      resolvePayloadUser(auth as never, authResult({ payloadUser: null }), req())
    ).resolves.toBeNull()
  })

  it('falls back to user when it structurally is a Payload user', async () => {
    const auth = { authenticate: async () => authResult() }
    await expect(
      resolvePayloadUser(auth as never, authResult({ user: PAYLOAD_USER }), req())
    ).resolves.toBe(PAYLOAD_USER)
  })

  it('fails closed for an external session with no mapping configured', async () => {
    const auth = { authenticate: async () => authResult() }
    await expect(resolvePayloadUser(auth as never, authResult(), req())).rejects.toBeInstanceOf(
      PuckApiAccessError
    )
  })
})

// ---------------------------------------------------------------------------
// Fail-closed behaviour end to end
// ---------------------------------------------------------------------------

describe('misconfigured auth fails closed', () => {
  it('returns 500 PUCK_ACCESS_MISCONFIGURED and touches no data', async () => {
    const { calls } = mockPayload()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlers = createPuckApiRoutesVersions(
      baseConfig({ authenticate: async () => ({ authenticated: true, user: SESSION_USER }) })
    )
    const res = await handlers.GET(req('http://localhost/api/puck/pages/p1/versions'), ctx())

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ code: 'PUCK_ACCESS_MISCONFIGURED' })

    // The critical half: it must fail *before* reading anything.
    expect(calls).toEqual([])
  })

  it('does not leak the remediation detail into the HTTP response body', async () => {
    mockPayload()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlers = createPuckApiRoutes(
      baseConfig({ authenticate: async () => ({ authenticated: true, user: SESSION_USER }) })
    )
    const res = await handlers.GET(req(), { params: Promise.resolve({}) })
    const body = (await res.json()) as { error: string }

    expect(body.error).not.toContain('toPayloadUser')
    expect(body.error).toContain('See the server logs')
  })

  it('still reports the misconfiguration through onError', async () => {
    mockPayload()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()

    const handlers = createPuckApiRoutesWithId({
      ...baseConfig({ authenticate: async () => ({ authenticated: true, user: SESSION_USER }) }),
      onError,
    })
    await handlers.DELETE(req('http://localhost/api/puck/pages/p1'), ctx())

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(PuckApiAccessError)
  })
})

// ---------------------------------------------------------------------------
// The documented escape hatch
// ---------------------------------------------------------------------------

describe('dangerouslyDisableCollectionAccessControl', () => {
  it('restores the unguarded behaviour only when explicitly set', async () => {
    const { calls } = mockPayload()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const handlers = createPuckApiRoutes({
      ...baseConfig({ authenticate: async () => ({ authenticated: true, user: SESSION_USER }) }),
      dangerouslyDisableCollectionAccessControl: true,
    })
    const res = await handlers.GET(req(), { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(calls[0].args.overrideAccess).toBe(true)
    expect(calls[0].args).not.toHaveProperty('user')
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('GHSA-957g-hmmp-rchg')
  })

  it('warns once per factory, not once per request', async () => {
    mockPayload()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const handlers = createPuckApiRoutes({
      ...baseConfig({ authenticate: async () => ({ authenticated: true, user: SESSION_USER }) }),
      dangerouslyDisableCollectionAccessControl: true,
    })
    await handlers.GET(req(), { params: Promise.resolve({}) })
    await handlers.GET(req(), { params: Promise.resolve({}) })
    await handlers.GET(req(), { params: Promise.resolve({}) })

    expect(warn).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Denials are denials, not server errors
// ---------------------------------------------------------------------------

describe('Payload access denials map to 403', () => {
  it('reports Forbidden as 403 rather than 500', async () => {
    mockPayload({ findVersions: new Forbidden() })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlers = createPuckApiRoutesVersions(baseConfig())
    const res = await handlers.GET(req('http://localhost/api/puck/pages/p1/versions'), ctx())

    expect(res.status).toBe(403)
  })

  it('maps a denied restore to 403', async () => {
    mockPayload({ restoreVersion: new Forbidden() })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlers = createPuckApiRoutesVersions(baseConfig())
    const res = await handlers.POST(
      jsonReq({ versionId: 'v1' }, 'http://localhost/api/puck/pages/p1/versions'),
      ctx()
    )

    expect(res.status).toBe(403)
  })

  it('leaves genuine server faults as 500', async () => {
    mockPayload({ findVersions: new Error('database exploded') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handlers = createPuckApiRoutesVersions(baseConfig())
    const res = await handlers.GET(req('http://localhost/api/puck/pages/p1/versions'), ctx())

    expect(res.status).toBe(500)
  })
})
