/**
 * Mapping Payload errors onto HTTP status codes.
 *
 * Payload's `APIError` (and its subclasses `Forbidden`, `NotFound`,
 * `ValidationError`, ...) carries the status the response should use. Handlers
 * that flatten everything to 500 turn an authorization *denial* into a server
 * *error*, which hides the access-control layer working correctly, breaks client
 * error handling, and pollutes error monitoring. That matters much more now that
 * access control is actually enforced on these routes.
 */

import { APIError } from 'payload'

/**
 * Extract the HTTP status Payload intends for an error.
 *
 * The `instanceof` check is the fast path. The structural fallback exists
 * because `payload` can legitimately be resolved more than once in a monorepo or
 * under pnpm's linking, and a duplicated class identity would silently defeat
 * `instanceof` — producing exactly the kind of environment-dependent flakiness
 * this mapping is meant to remove.
 *
 * @returns the status code, or `null` if this is not a Payload API error.
 */
export function payloadErrorStatus(error: unknown): number | null {
  if (error instanceof APIError && typeof error.status === 'number') {
    return error.status
  }

  if (error instanceof Error) {
    const candidate = error as Error & { status?: unknown; isOperational?: unknown }
    if (
      typeof candidate.status === 'number' &&
      candidate.status >= 400 &&
      candidate.status <= 599 &&
      typeof candidate.isOperational === 'boolean'
    ) {
      return candidate.status
    }
  }

  return null
}

/**
 * True when Payload rejected the operation because access control denied it.
 *
 * Used to keep denial responses free of internal detail — a 403 body should not
 * describe which rule failed.
 */
export function isForbiddenError(error: unknown): boolean {
  return payloadErrorStatus(error) === 403
}

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
}

/**
 * Turn a Payload client error (4xx) into the response it should have produced.
 *
 * Returns `null` for anything that is not a Payload 4xx — including genuine 5xx
 * faults — so callers fall through to their existing generic handling. Call it
 * *after* any bespoke handling (`ValidationError`, `HomepageConflictError`) so
 * those keep precedence.
 *
 * Payload marks user-facing errors with `isPublic`. Messages from errors that
 * are not public are replaced with a generic one, so internal detail is never
 * echoed back to the caller.
 */
export function payloadErrorResponse(error: unknown): Response | null {
  const status = payloadErrorStatus(error)
  if (status === null || status < 400 || status >= 500) return null

  const isPublic =
    error instanceof Error &&
    (error as Error & { isPublic?: unknown }).isPublic === true

  const message =
    isPublic && error.message
      ? error.message
      : (CLIENT_ERROR_MESSAGES[status] ?? 'Request failed')

  return Response.json({ error: message }, { status })
}
