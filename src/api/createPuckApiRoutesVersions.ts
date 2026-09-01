import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import type {
  PuckApiRoutesConfig,
  PuckApiVersionsRouteHandlers,
  RouteHandlerWithIdContext,
} from './types.js'
import { resolveLocaleFromNextRequest } from '../utils/locale.js'
import {
  createAccessResolver,
  accessMisconfigurationResponse,
} from './utils/access.js'
import { payloadErrorResponse } from '../utils/payloadErrors.js'

/**
 * Create API route handlers for /api/puck/pages/[id]/versions
 *
 * Provides GET (list versions) and POST (restore version) handlers
 * for managing page version history.
 *
 * @example
 * ```typescript
 * // src/app/api/puck/pages/[id]/versions/route.ts
 * import { createPuckApiRoutesVersions } from '@delmaredigital/payload-puck/api'
 * import config from '@payload-config'
 *
 * export const { GET, POST } = createPuckApiRoutesVersions({
 *   collection: 'pages',
 *   payloadConfig: config,
 *   auth: {
 *     authenticate: async (request) => {
 *       const session = await getSession(request)
 *       if (!session?.user) return { authenticated: false }
 *       return { authenticated: true, user: session.user }
 *     },
 *   },
 * })
 * ```
 */
export function createPuckApiRoutesVersions(
  routeConfig: PuckApiRoutesConfig
): PuckApiVersionsRouteHandlers {
  const {
    collection = 'pages',
    payloadConfig,
    auth,
    onError,
  } = routeConfig

  // Resolves { overrideAccess, user } for every Payload call below. Built once
  // so the opt-out warning is logged per factory, not per request.
  const resolveAccess = createAccessResolver(routeConfig)

  /**
   * GET /api/puck/pages/[id]/versions
   * Fetch version history for a page
   */
  async function GET(
    request: NextRequest,
    context: RouteHandlerWithIdContext
  ): Promise<Response> {
    try {
      // Get page ID from params
      const params = await context.params
      const id = params.id

      if (!id) {
        return NextResponse.json(
          { error: 'Page ID is required' },
          { status: 400 }
        )
      }

      // Authenticate
      const authResult = await auth.authenticate(request)
      if (!authResult.authenticated || !authResult.user) {
        return NextResponse.json(
          { error: authResult.error || 'Unauthorized' },
          { status: 401 }
        )
      }

      // Check view permission
      if (auth.canView) {
        const permission = await auth.canView(authResult.user, id)
        if (!permission.allowed) {
          return NextResponse.json(
            { error: permission.error || 'Forbidden' },
            { status: 403 }
          )
        }
      }

      // Get Payload instance with provided config
      const config = await payloadConfig
      const payload = await getPayload({ config })

      // Parse query params for pagination
      const url = new URL(request.url)
      const limit = parseInt(url.searchParams.get('limit') || '20', 10)
      const page = parseInt(url.searchParams.get('page') || '1', 10)
      const locale = resolveLocaleFromNextRequest(request)

      const access = await resolveAccess(authResult, request)

      // Fetch versions for this page. Access control is evaluated by Payload so
      // a caller only ever sees versions of documents they may read.
      const versions = await payload.findVersions({
        collection,
        ...access(),
        where: {
          parent: { equals: id },
        },
        sort: '-updatedAt',
        limit,
        page,
        ...(locale ? { locale: locale.toString() } : {}),
      })

      return NextResponse.json({
        docs: versions.docs,
        totalDocs: versions.totalDocs,
        totalPages: versions.totalPages,
        page: versions.page,
        limit: versions.limit,
        hasPrevPage: versions.hasPrevPage,
        hasNextPage: versions.hasNextPage,
      })
    } catch (error) {
      const params = await context.params
      if (onError) {
        onError(error, { operation: 'listVersions', request, pageId: params.id })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error fetching versions:', error)
      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to fetch versions' },
        { status: 500 }
      )
    }
  }

  /**
   * POST /api/puck/pages/[id]/versions
   * Restore a specific version
   *
   * Request Body:
   * - versionId: string - The version ID to restore
   */
  async function POST(
    request: NextRequest,
    context: RouteHandlerWithIdContext
  ): Promise<Response> {
    try {
      // Get page ID from params
      const params = await context.params
      const id = params.id

      if (!id) {
        return NextResponse.json(
          { error: 'Page ID is required' },
          { status: 400 }
        )
      }

      // Authenticate
      const authResult = await auth.authenticate(request)
      if (!authResult.authenticated || !authResult.user) {
        return NextResponse.json(
          { error: authResult.error || 'Unauthorized' },
          { status: 401 }
        )
      }

      // Check edit permission
      if (auth.canEdit) {
        const permission = await auth.canEdit(authResult.user, id)
        if (!permission.allowed) {
          return NextResponse.json(
            { error: permission.error || 'Forbidden' },
            { status: 403 }
          )
        }
      }

      // Parse request body
      const body = await request.json()
      const { versionId } = body as { versionId: string }

      if (!versionId) {
        return NextResponse.json(
          { error: 'Version ID is required' },
          { status: 400 }
        )
      }

      // Get Payload instance with provided config
      const config = await payloadConfig
      const payload = await getPayload({ config })

      const access = await resolveAccess(authResult, request)

      // Restore the version. Payload evaluates `update` access on the parent
      // document, so restoring is gated by the same rules as editing it.
      const restoredDoc = await payload.restoreVersion({
        collection,
        ...access(),
        id: versionId,
      })

      return NextResponse.json({ doc: restoredDoc })
    } catch (error) {
      const params = await context.params
      if (onError) {
        onError(error, { operation: 'restoreVersion', request, pageId: params.id })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error restoring version:', error)
      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to restore version' },
        { status: 500 }
      )
    }
  }

  return { GET, POST }
}
