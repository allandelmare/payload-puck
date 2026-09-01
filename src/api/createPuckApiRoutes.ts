import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import type { Where } from 'payload'
import type { Data as PuckData } from '@puckeditor/core'
import type {
  PuckApiRoutesConfig,
  PuckApiRouteHandlers,
  CreatePageBody,
  RouteHandlerContext,
} from './types.js'
import {
  createAccessResolver,
  accessMisconfigurationResponse,
} from './utils/access.js'
import { payloadErrorResponse } from '../utils/payloadErrors.js'

/**
 * Default Puck data for new pages
 */
const DEFAULT_PUCK_DATA: PuckData = {
  root: {
    props: {
      title: '',
    } as Record<string, unknown>,
  },
  content: [],
  zones: {},
}

/**
 * Create API route handlers for /api/puck/pages
 *
 * Provides GET (list pages) and POST (create page) handlers
 * with configurable authentication and authorization.
 *
 * @example
 * ```typescript
 * // src/app/api/puck/pages/route.ts
 * import { createPuckApiRoutes } from '@delmaredigital/payload-puck/api'
 * import config from '@payload-config'
 *
 * export const { GET, POST } = createPuckApiRoutes({
 *   collection: 'pages',
 *   payloadConfig: config,
 *   auth: {
 *     authenticate: async (request) => {
 *       const session = await getSession(request)
 *       if (!session?.user) return { authenticated: false }
 *       return { authenticated: true, user: session.user }
 *     },
 *     canCreate: async (user) => {
 *       return { allowed: user.role === 'admin' || user.role === 'editor' }
 *     },
 *   },
 * })
 * ```
 */
export function createPuckApiRoutes(
  routeConfig: PuckApiRoutesConfig
): PuckApiRouteHandlers {
  const {
    collection = 'pages',
    payloadConfig,
    auth,
    defaultPuckData = DEFAULT_PUCK_DATA,
    enableDrafts = true,
    onError,
  } = routeConfig

  // Resolves { overrideAccess, user } for every Payload call below. Built once
  // so the opt-out warning is logged per factory, not per request.
  const resolveAccess = createAccessResolver(routeConfig)

  /**
   * GET /api/puck/pages
   * List all pages with optional filtering
   *
   * Query Parameters:
   * - page: Page number (default: 1)
   * - limit: Items per page (default: 10)
   * - search: Search in title field
   * - status: Filter by _status ('draft', 'published', 'all')
   * - editorVersion: Filter by editorVersion field
   * - sort: Sort field (default: '-updatedAt')
   */
  async function GET(request: NextRequest, _context: RouteHandlerContext): Promise<Response> {
    try {
      // Authenticate
      const authResult = await auth.authenticate(request)
      if (!authResult.authenticated || !authResult.user) {
        return NextResponse.json(
          { error: authResult.error || 'Unauthorized' },
          { status: 401 }
        )
      }

      // Check list permission
      if (auth.canList) {
        const permission = await auth.canList(authResult.user)
        if (!permission.allowed) {
          return NextResponse.json(
            { error: permission.error || 'Forbidden' },
            { status: 403 }
          )
        }
      }

      // Parse query parameters
      const { searchParams } = new URL(request.url)
      const page = parseInt(searchParams.get('page') || '1', 10)
      const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100)
      const search = searchParams.get('search') || ''
      const status = searchParams.get('status')
      const editorVersion = searchParams.get('editorVersion')
      const sort = searchParams.get('sort') || '-updatedAt'

      // Get Payload instance with provided config
      const config = await payloadConfig
      const payload = await getPayload({ config })

      // Build where clause
      const conditions: Where[] = []

      if (search) {
        conditions.push({ title: { contains: search } })
      }

      if (status && status !== 'all') {
        conditions.push({ _status: { equals: status } })
      }

      if (editorVersion && editorVersion !== 'all') {
        conditions.push({ editorVersion: { equals: editorVersion } })
      }

      const where: Where | undefined =
        conditions.length > 0
          ? conditions.length === 1
            ? conditions[0]
            : { and: conditions }
          : undefined

      const access = await resolveAccess(authResult, request)

      // Access control is evaluated by Payload, so the page list is filtered to
      // documents the caller may actually read.
      const result = await payload.find({
        collection,
        ...access(),
        page,
        limit,
        sort,
        where,
      })

      return NextResponse.json(result)
    } catch (error) {
      if (onError) {
        onError(error, { operation: 'list', request })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error listing pages:', error)
      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to list pages' },
        { status: 500 }
      )
    }
  }

  /**
   * POST /api/puck/pages
   * Create a new page with Puck data
   *
   * Request Body:
   * - title: string (required)
   * - slug: string (required)
   * - puckData?: PuckData (optional, uses default if not provided)
   * - status?: 'draft' | 'published' (default: 'draft')
   */
  async function POST(request: NextRequest, _context: RouteHandlerContext): Promise<Response> {
    try {
      // Authenticate
      const authResult = await auth.authenticate(request)
      if (!authResult.authenticated || !authResult.user) {
        return NextResponse.json(
          { error: authResult.error || 'Unauthorized' },
          { status: 401 }
        )
      }

      // Check create permission
      if (auth.canCreate) {
        const permission = await auth.canCreate(authResult.user)
        if (!permission.allowed) {
          return NextResponse.json(
            { error: permission.error || 'Forbidden' },
            { status: 403 }
          )
        }
      }

      // Parse request body
      const body = (await request.json()) as CreatePageBody
      const { title, slug, puckData, status = 'draft' } = body

      // Validate required fields
      if (!title || !slug) {
        return NextResponse.json(
          { error: 'Title and slug are required' },
          { status: 400 }
        )
      }

      // Get Payload instance with provided config
      const config = await payloadConfig
      const payload = await getPayload({ config })

      const access = await resolveAccess(authResult, request)

      // Check if slug already exists. This runs under access control, so a
      // caller cannot use it to probe for the existence of documents they may
      // not read. The trade-off is that an unreadable collision is not caught
      // here — Payload's unique constraint catches it on create below, and the
      // ValidationError handler maps it back to the same 409.
      const existing = await payload.find({
        collection,
        ...access(),
        where: { slug: { equals: slug } },
        limit: 1,
      })

      if (existing.docs.length > 0) {
        return NextResponse.json(
          { error: 'A page with this slug already exists' },
          { status: 409 }
        )
      }

      // Prepare initial Puck data with title in root.props
      const initialPuckData = puckData || {
        ...defaultPuckData,
        root: {
          ...defaultPuckData.root,
          props: {
            ...(defaultPuckData.root as { props?: Record<string, unknown> })?.props,
            title,
          },
        },
      }

      // Create the page
      const newPage = await payload.create({
        collection,
        ...access(),
        draft: enableDrafts,
        data: {
          title,
          slug,
          editorVersion: 'puck',
          puckData: initialPuckData,
          _status: status,
        },
      })

      return NextResponse.json({ doc: newPage }, { status: 201 })
    } catch (error) {
      if (onError) {
        onError(error, { operation: 'create', request })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error creating page:', error)

      // A unique-constraint failure on slug means the page exists but was not
      // visible to the pre-check above under access control. Report the same 409
      // the pre-check would have, rather than a generic 500.
      if (error instanceof Error && error.name === 'ValidationError') {
        const validationError = error as Error & {
          data?: { errors?: Array<{ field: string; message: string }> }
        }
        const fieldErrors = validationError.data?.errors || []
        if (fieldErrors.some((e) => e.field === 'slug')) {
          return NextResponse.json(
            { error: 'A page with this slug already exists' },
            { status: 409 }
          )
        }
        return NextResponse.json(
          {
            error: `Validation failed: ${fieldErrors.map((e) => e.message || e.field).join(', ')}`,
            details: fieldErrors,
          },
          { status: 400 }
        )
      }

      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to create page' },
        { status: 500 }
      )
    }
  }

  return { GET, POST }
}
