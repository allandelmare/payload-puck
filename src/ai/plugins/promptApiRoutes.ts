import type { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import type { SanitizedConfig } from 'payload'
import type { PuckApiAuthHooks, RouteHandler, RouteHandlerWithId } from '../../api/types.js'
import {
  createAccessResolver,
  accessMisconfigurationResponse,
} from '../../api/utils/access.js'
import { payloadErrorResponse } from '../../utils/payloadErrors.js'

/**
 * Configuration for AI prompts API routes
 */
export interface PromptApiRoutesConfig {
  /**
   * Payload configuration - import from @payload-config
   */
  payloadConfig: Promise<SanitizedConfig>
  /**
   * Authentication hooks
   */
  auth: PuckApiAuthHooks
  /**
   * Collection slug for prompts
   * @default 'puck-ai-prompts'
   */
  collection?: string
  /**
   * **SECURITY — see `PuckApiRoutesConfig.dangerouslyDisableCollectionAccessControl`.**
   * Restores the pre-0.9.0 behaviour in which Payload collection access rules
   * were not enforced on these routes.
   *
   * @default false
   */
  dangerouslyDisableCollectionAccessControl?: true
}

/**
 * Creates API route handlers for /api/puck/ai-prompts
 *
 * Provides CRUD operations for AI prompts stored in Payload.
 *
 * @example
 * ```typescript
 * // app/api/puck/ai-prompts/route.ts
 * import { createPromptApiRoutes } from '@delmaredigital/payload-puck/ai'
 * import config from '@payload-config'
 *
 * const handlers = createPromptApiRoutes({
 *   payloadConfig: config,
 *   auth: {
 *     authenticate: async (request) => { ... },
 *   },
 * })
 *
 * export const GET = handlers.GET
 * export const POST = handlers.POST
 * ```
 *
 * @example
 * ```typescript
 * // app/api/puck/ai-prompts/[id]/route.ts
 * import { createPromptApiRoutesWithId } from '@delmaredigital/payload-puck/ai'
 *
 * const handlers = createPromptApiRoutesWithId({
 *   payloadConfig: config,
 *   auth: { ... },
 * })
 *
 * export const PATCH = handlers.PATCH
 * export const DELETE = handlers.DELETE
 * ```
 */
export function createPromptApiRoutes(config: PromptApiRoutesConfig): {
  GET: RouteHandler
  POST: RouteHandler
} {
  const { payloadConfig, auth, collection = 'puck-ai-prompts' } = config

  // Resolves { overrideAccess, user } for every Payload call below.
  const resolveAccess = createAccessResolver(config)

  return {
    GET: async (request: NextRequest): Promise<Response> => {
      try {
        // Authenticate
        const authResult = await auth.authenticate(request)
        if (!authResult.authenticated || !authResult.user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Get Payload instance
        const payload = await getPayload({ config: await payloadConfig })

        // Fetch prompts
        const access = await resolveAccess(authResult, request)

        const result = await payload.find({
          collection,
          ...access(),
          sort: 'order',
          limit: 100,
        })

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const misconfigured = accessMisconfigurationResponse(error)
        if (misconfigured) return misconfigured

        const mapped = payloadErrorResponse(error)
        if (mapped) return mapped

        console.error('[AI Prompts] Error fetching prompts:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to fetch prompts' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    },

    POST: async (request: NextRequest): Promise<Response> => {
      try {
        // Authenticate
        const authResult = await auth.authenticate(request)
        if (!authResult.authenticated || !authResult.user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Get Payload instance
        const payload = await getPayload({ config: await payloadConfig })

        // Parse body
        const body = await request.json()

        // Create prompt
        const access = await resolveAccess(authResult, request)

        const result = await payload.create({
          collection,
          ...access(),
          data: {
            label: body.label,
            prompt: body.prompt,
            category: body.category,
            order: body.order ?? 0,
          },
        })

        return new Response(JSON.stringify({ doc: result }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const misconfigured = accessMisconfigurationResponse(error)
        if (misconfigured) return misconfigured

        const mapped = payloadErrorResponse(error)
        if (mapped) return mapped

        console.error('[AI Prompts] Error creating prompt:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to create prompt' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    },
  }
}

/**
 * Creates API route handlers for /api/puck/ai-prompts/[id]
 */
export function createPromptApiRoutesWithId(config: PromptApiRoutesConfig): {
  PATCH: RouteHandlerWithId
  DELETE: RouteHandlerWithId
} {
  const { payloadConfig, auth, collection = 'puck-ai-prompts' } = config

  // Resolves { overrideAccess, user } for every Payload call below.
  const resolveAccess = createAccessResolver(config)

  return {
    PATCH: async (request: NextRequest, context): Promise<Response> => {
      try {
        // Authenticate
        const authResult = await auth.authenticate(request)
        if (!authResult.authenticated || !authResult.user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Get ID from params
        const params = await context.params
        const id = params.id

        // Get Payload instance
        const payload = await getPayload({ config: await payloadConfig })

        // Parse body
        const body = await request.json()

        // Update prompt
        const access = await resolveAccess(authResult, request)

        const result = await payload.update({
          collection,
          ...access(),
          id,
          data: {
            ...(body.label !== undefined && { label: body.label }),
            ...(body.prompt !== undefined && { prompt: body.prompt }),
            ...(body.category !== undefined && { category: body.category }),
            ...(body.order !== undefined && { order: body.order }),
          },
        })

        return new Response(JSON.stringify({ doc: result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const misconfigured = accessMisconfigurationResponse(error)
        if (misconfigured) return misconfigured

        const mapped = payloadErrorResponse(error)
        if (mapped) return mapped

        console.error('[AI Prompts] Error updating prompt:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to update prompt' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    },

    DELETE: async (request: NextRequest, context): Promise<Response> => {
      try {
        // Authenticate
        const authResult = await auth.authenticate(request)
        if (!authResult.authenticated || !authResult.user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Get ID from params
        const params = await context.params
        const id = params.id

        // Get Payload instance
        const payload = await getPayload({ config: await payloadConfig })

        // Delete prompt
        const access = await resolveAccess(authResult, request)

        await payload.delete({
          collection,
          ...access(),
          id,
        })

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        const misconfigured = accessMisconfigurationResponse(error)
        if (misconfigured) return misconfigured

        const mapped = payloadErrorResponse(error)
        if (mapped) return mapped

        console.error('[AI Prompts] Error deleting prompt:', error)
        return new Response(
          JSON.stringify({ error: 'Failed to delete prompt' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }
    },
  }
}
