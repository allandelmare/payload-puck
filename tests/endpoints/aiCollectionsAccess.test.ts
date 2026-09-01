/**
 * Regression tests for GHSA-rrx7-m589-5wfq.
 *
 * The AI context/prompts endpoints gated only on `if (!req.user)` and then called
 * the Local API with Payload's `overrideAccess: true` default. Any authenticated
 * user — including one from an unrelated auth-enabled collection, such as a
 * front-end `customers` collection — could therefore list, create, update and
 * delete the entries that make up the AI system prompt, regardless of the
 * collection's own `access` rules.
 *
 * `req.user` is authentication. These tests pin the authorization.
 */

import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  createContextListHandler,
  createContextCreateHandler,
  createContextUpdateHandler,
  createContextDeleteHandler,
} from '../../src/endpoints/context.js'
import {
  createPromptsListHandler,
  createPromptsCreateHandler,
  createPromptsUpdateHandler,
  createPromptsDeleteHandler,
} from '../../src/endpoints/prompts.js'

type RecordedCall = { op: string; args: Record<string, unknown> }

function fakeRequest(overrides: Partial<PayloadRequest> = {}) {
  const calls: RecordedCall[] = []

  const op = (name: string) =>
    vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ op: name, args })
      return name === 'find' ? { docs: [], totalDocs: 0 } : { id: 'x1' }
    })

  const req = {
    user: { id: 'u1', collection: 'users' },
    routeParams: { id: 'c1' },
    query: {},
    json: async () => ({ name: 'n', content: 'c' }),
    payload: {
      find: op('find'),
      create: op('create'),
      update: op('update'),
      delete: op('delete'),
    },
    ...overrides,
  } as unknown as PayloadRequest

  return { req, calls }
}

const HANDLERS = [
  ['context.list', createContextListHandler],
  ['context.create', createContextCreateHandler],
  ['context.update', createContextUpdateHandler],
  ['context.delete', createContextDeleteHandler],
  ['prompts.list', createPromptsListHandler],
  ['prompts.create', createPromptsCreateHandler],
  ['prompts.update', createPromptsUpdateHandler],
  ['prompts.delete', createPromptsDeleteHandler],
] as const

describe('AI context and prompts endpoints enforce collection access', () => {
  it.each(HANDLERS)('%s passes overrideAccess:false and req', async (_name, factory) => {
    const { req, calls } = fakeRequest()

    await factory()(req)

    expect(calls).toHaveLength(1)
    expect(calls[0].args.overrideAccess).toBe(false)
    // Threading `req` is what carries the user and the active transaction into
    // the access-control evaluation.
    expect(calls[0].args.req).toBe(req)
  })

  it.each(HANDLERS)('%s still rejects unauthenticated callers', async (_name, factory) => {
    const { req, calls } = fakeRequest({ user: null } as Partial<PayloadRequest>)

    const res = await factory()(req)

    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})

describe('access denials are reported as denials', () => {
  it('surfaces a Payload 403 as 403, not 500', async () => {
    const forbidden = Object.assign(new Error('You are not allowed to perform this action.'), {
      status: 403,
      isOperational: true,
      isPublic: true,
    })

    const { req } = fakeRequest()
    vi.mocked(req.payload.delete).mockRejectedValueOnce(forbidden)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await createContextDeleteHandler()(req)

    expect(res.status).toBe(403)
  })

  it('leaves an unexpected fault as 500', async () => {
    const { req } = fakeRequest()
    vi.mocked(req.payload.delete).mockRejectedValueOnce(new Error('database exploded'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await createContextDeleteHandler()(req)

    expect(res.status).toBe(500)
  })
})
