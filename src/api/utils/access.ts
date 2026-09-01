/**
 * Access-control resolution for the standalone Next.js route factories.
 *
 * ## Why this exists
 *
 * Payload's Local API defaults to `overrideAccess: true`, which skips collection
 * and field access control entirely. The route factories in `src/api/` call the
 * Local API directly (they hold a `Payload` instance, not a `PayloadRequest`), so
 * without an explicit opt-in every operation ran unauthorized. `authenticate` and
 * the `canX` hooks are *authentication* plus coarse route gating — they are not a
 * substitute for the collection's own `access` rules.
 *
 * This module is the single place that decides what `{ overrideAccess, user }` a
 * Local API call receives. Every sink in every factory spreads its result, so the
 * invariant is enforced in one place rather than at eleven call sites.
 *
 * ## The problem it has to solve
 *
 * `PuckApiAuthHooks.authenticate` is deliberately bring-your-own: it may return a
 * Better Auth session user, a NextAuth user, or a decoded JWT payload. Payload's
 * access functions expect a Payload user document. Handing them a foreign-shaped
 * object produces silently wrong authorization, which is worse than none.
 *
 * So the resolution is explicit and fails closed — see {@link resolvePayloadUser}.
 */

import type { NextRequest } from 'next/server'
import type { AuthResult, PayloadUser, PuckApiAuthHooks } from '../types.js'

/**
 * The slice of a route config the resolver needs. Kept structural so any factory
 * carrying auth hooks can use it without depending on one config interface.
 */
export interface AccessResolverConfig {
  auth: PuckApiAuthHooks
  dangerouslyDisableCollectionAccessControl?: true
}

/**
 * Arguments spread into every Payload Local API call made by the route factories.
 *
 * `user` is intentionally always present (possibly `null`) when access control is
 * on: `null` means "evaluate as an anonymous request", which is a deliberate
 * state, not a missing value.
 *
 * `req` carries the *original request headers*. Access rules routinely read them
 * — an API-key scope check cannot see its own key otherwise — and `createLocalReq`
 * substitutes an empty `Headers` when no `req` is passed, which makes such a rule
 * silently misjudge the request. For an API-key caller that can fail **open**.
 */
export type PayloadAccessArgs =
  | {
      overrideAccess: false
      user: PayloadUser | null
      req: { headers: Headers }
    }
  | { overrideAccess: true }

/**
 * Mints the arguments for one Local API call.
 *
 * This is a factory rather than a value on purpose. `createLocalReq` **mutates**
 * the `req` it is given (assigning `locale`, `context`, `payload`, `user`, a
 * dataloader) and returns it. Sharing one object across the several sinks in a
 * handler would let those assignments leak between operations. Each call gets a
 * fresh object.
 */
export type AccessArgsFactory = () => PayloadAccessArgs

/**
 * Thrown when the route factory cannot determine which Payload user to evaluate
 * access control against.
 *
 * This is a configuration fault, not a request fault. It is surfaced as a 500
 * with an actionable message rather than being papered over, because both of the
 * alternatives are bugs: evaluating as anonymous silently downgrades every
 * request, and skipping access control reintroduces the vulnerability.
 */
export class PuckApiAccessError extends Error {
  override readonly name = 'PuckApiAccessError'

  constructor(message: string) {
    super(message)
    // Preserve the prototype chain when compiled down to ES5-era output.
    Object.setPrototypeOf(this, PuckApiAccessError.prototype)
  }
}

const MISCONFIGURED_MESSAGE = [
  '[payload-puck] Cannot resolve a Payload user for this request, so collection',
  'access control cannot be evaluated. The route factory refuses to run the',
  'operation rather than bypass authorization.',
  '',
  'THE FIX, for almost every case: build `authenticate` on `payload.auth()`',
  'rather than on your auth library directly. It runs whatever auth strategies',
  'your Payload config registers — Better Auth, Clerk, custom strategies — and',
  'returns a real Payload user:',
  '',
  '    authenticate: async (request) => {',
  '      const payload = await getPayload({ config })',
  '      const { user } = await payload.auth({ headers: request.headers })',
  '      if (!user) return { authenticated: false }',
  '      return { authenticated: true, user }',
  '    }',
  '',
  'This is the recommended wiring even when your session comes from Better Auth',
  'or NextAuth. Do NOT look the user up by email and return the bare row: that',
  'silently drops the fields your auth strategy decorates onto the user (for',
  'Better Auth: activeOrganizationId, organizationRole, apiKeyScopes,',
  'oauthScopes), and access rules that read them then reach the wrong decision —',
  'in the API-key case, potentially a permissive one.',
  '',
  'Only if your caller genuinely has no corresponding Payload user:',
  '',
  '  - Return `payloadUser` from `authenticate`, or implement `toPayloadUser`, if',
  '    you can construct the equivalent Payload user yourself — including every',
  '    field your access rules read.',
  '  - Use `toPayloadUser: () => null` to deliberately evaluate access control as',
  '    an anonymous (public) request.',
  '',
  'As a last resort you may set `dangerouslyDisableCollectionAccessControl: true`',
  'on the route config. That restores the pre-fix behaviour in which Payload',
  'collection and field access rules are NOT enforced on these routes, leaving the',
  '`canX` hooks as your only authorization. See GHSA-957g-hmmp-rchg.',
].join('\n')

/**
 * Structural check for "this is a Payload user document".
 *
 * Payload stamps `collection` onto the authenticated user (`BaseUser` in
 * `payload/auth/types`), and nothing else in the auth pipeline does. Combined
 * with an `id`, it is a reliable discriminator between a Payload user and an
 * arbitrary session object, and it is what lets the recommended wiring —
 * `authenticate` built on `payload.auth()` — work with no extra configuration.
 *
 * Deliberately *stricter* than Payload itself, which tolerates a missing
 * `collection` by silently defaulting it. That tolerance is the footgun;
 * refusing the input is the point.
 */
export function isPayloadUser(value: unknown): value is PayloadUser {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const hasId = typeof candidate.id === 'string' || typeof candidate.id === 'number'
  return hasId && typeof candidate.collection === 'string'
}

/**
 * Resolve the Payload user that access control should be evaluated against.
 *
 * Resolution order — first match wins, and every branch is an explicit signal
 * from the integrator rather than a guess:
 *
 * 1. `auth.toPayloadUser` — the explicit mapping hook. Its return value is used
 *    verbatim, including `null`, which means "evaluate as anonymous".
 * 2. `authResult.payloadUser` — set by `authenticate` itself when it already did
 *    the lookup. `null` is honoured the same way.
 * 3. `authResult.user`, when it structurally *is* a Payload user. This is the
 *    zero-config path for Payload-auth integrators.
 * 4. Otherwise: throw. We cannot tell whether the session maps to a privileged
 *    user or to nobody, and guessing either way is a security bug.
 *
 * There is deliberately **no** automatic `payload.auth()` fallback at step 4.
 * It would re-run the auth pipeline on every request: for an API-key caller that
 * double-decrements the key's remaining quota and rate-limit budget (and Better
 * Auth deletes keys on exhaustion), and it can resolve a *different* principal
 * than the one the `canX` hooks already gated — a confused deputy. The zero-cost
 * path is for `authenticate` itself to call `payload.auth()`, which step 3 then
 * accepts.
 *
 * @throws {PuckApiAccessError} when no branch matches.
 */
export async function resolvePayloadUser(
  auth: PuckApiAuthHooks,
  authResult: AuthResult,
  request: NextRequest
): Promise<PayloadUser | null> {
  if (auth.toPayloadUser) {
    const mapped = await auth.toPayloadUser(authResult.user!, request)
    return mapped ?? null
  }

  if (authResult.payloadUser !== undefined) {
    return authResult.payloadUser ?? null
  }

  if (isPayloadUser(authResult.user)) {
    return authResult.user
  }

  throw new PuckApiAccessError(MISCONFIGURED_MESSAGE)
}

/**
 * Build the access resolver for one route factory.
 *
 * Returns a function that resolves the acting user once per request and hands
 * back an {@link AccessArgsFactory} to mint per-sink arguments. The closure holds
 * the "already warned" flag, so the opt-out warning is emitted once per factory
 * rather than once per request.
 */
export function createAccessResolver(routeConfig: AccessResolverConfig) {
  const { auth, dangerouslyDisableCollectionAccessControl } = routeConfig
  let warned = false

  return async function resolveAccess(
    authResult: AuthResult,
    request: NextRequest
  ): Promise<AccessArgsFactory> {
    if (dangerouslyDisableCollectionAccessControl === true) {
      if (!warned) {
        warned = true
        console.warn(
          '[payload-puck] SECURITY: `dangerouslyDisableCollectionAccessControl` is ' +
            'enabled on a Puck API route. Payload collection and field access rules ' +
            'are NOT enforced on these routes; the `canX` hooks are the only ' +
            'authorization in effect. See GHSA-957g-hmmp-rchg.'
        )
      }
      return () => ({ overrideAccess: true })
    }

    const user = await resolvePayloadUser(auth, authResult, request)

    return () => ({
      overrideAccess: false,
      user,
      // Fresh per call — createLocalReq mutates whatever it is given.
      req: { headers: request.headers },
    })
  }
}

/**
 * Map a thrown {@link PuckApiAccessError} onto a response.
 *
 * Returns `null` for every other error so callers can fall through to their
 * existing handling. Without this, the factories' generic `catch` blocks would
 * flatten a misconfiguration into "Failed to list pages", which is the hardest
 * possible thing to debug.
 */
export function accessMisconfigurationResponse(error: unknown): Response | null {
  if (!(error instanceof PuckApiAccessError)) return null

  console.error(error.message)
  return Response.json(
    {
      error:
        'Server misconfiguration: Puck API routes cannot resolve a Payload user ' +
        'for access control. See the server logs for the fix.',
      code: 'PUCK_ACCESS_MISCONFIGURED',
    },
    { status: 500 }
  )
}
