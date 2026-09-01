import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import type {
  PuckApiRoutesConfig,
  PuckApiRouteWithIdHandlers,
  UpdatePageBody,
  RouteHandlerWithIdContext,
} from './types.js'
import { mapRootPropsToPayloadFields, deepMerge } from './utils/mapRootProps.js'
import {
  createAccessResolver,
  accessMisconfigurationResponse,
} from './utils/access.js'
import type { PayloadAccessArgs } from './utils/access.js'
import { payloadErrorResponse } from '../utils/payloadErrors.js'

/**
 * Create API route handlers for /api/puck/pages/[id]
 *
 * Provides GET (fetch page), PATCH (update page), and DELETE (delete page)
 * handlers with configurable authentication and authorization.
 *
 * @example
 * ```typescript
 * // src/app/api/puck/pages/[id]/route.ts
 * import { createPuckApiRoutesWithId } from '@delmaredigital/payload-puck/api'
 * import config from '@payload-config'
 *
 * export const { GET, PATCH, DELETE } = createPuckApiRoutesWithId({
 *   collection: 'pages',
 *   payloadConfig: config,
 *   auth: {
 *     authenticate: async (request) => {
 *       const session = await getSession(request)
 *       if (!session?.user) return { authenticated: false }
 *       return { authenticated: true, user: session.user }
 *     },
 *     canPublish: async (user) => {
 *       return { allowed: user.role === 'admin' }
 *     },
 *   },
 *   rootPropsMapping: [
 *     { from: 'customField', to: 'customPayloadField' },
 *   ],
 * })
 * ```
 */
export function createPuckApiRoutesWithId(
  routeConfig: PuckApiRoutesConfig
): PuckApiRouteWithIdHandlers {
  const {
    collection = 'pages',
    payloadConfig,
    auth,
    rootPropsMapping,
    onError,
  } = routeConfig

  // Resolves { overrideAccess, user } for every Payload call below. Built once
  // so the opt-out warning is logged per factory, not per request.
  const resolveAccess = createAccessResolver(routeConfig)

  /**
   * GET /api/puck/pages/[id]
   * Fetch a single page by ID
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

      // Check if caller wants draft or published version
      // Default to draft=true for editor use (load latest draft)
      const url = new URL(request.url)
      const wantsDraft = url.searchParams.get('draft') !== 'false'

      const access = await resolveAccess(authResult, request)

      const page = await payload.findByID({
        collection,
        ...access(),
        id,
        draft: wantsDraft, // Load draft version by default for editing
      })

      if (!page) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 })
      }

      return NextResponse.json({ doc: page })
    } catch (error) {
      const params = await context.params
      if (onError) {
        onError(error, { operation: 'read', request, pageId: params.id })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error fetching page:', error)
      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to fetch page' },
        { status: 500 }
      )
    }
  }

  /**
   * PATCH /api/puck/pages/[id]
   * Update a page with Puck data
   *
   * Request Body:
   * - puckData?: PuckData - Full Puck editor data
   * - title?: string - Override title (also synced from root.props)
   * - slug?: string - Override slug (also synced from root.props)
   * - status?: 'draft' | 'published' - Publishing status
   *
   * Root props from puckData are automatically synced to Payload fields
   * based on the configured mappings.
   */
  async function PATCH(
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
      const body = (await request.json()) as UpdatePageBody
      const { puckData, title, slug, status: statusField, _status, draft, isHomepage, swapHomepage, folder, pageSegment } = body
      // Accept both `status` and `_status` (editor sends `_status` per Payload convention)
      const status = statusField || _status

      // Check publish permission only if explicitly publishing
      if (status === 'published') {
        const canPublish = auth.canPublish || auth.canEdit
        if (canPublish) {
          const permission = await canPublish(authResult.user, id)
          if (!permission.allowed) {
            return NextResponse.json(
              { error: permission.error || 'Not authorized to publish pages' },
              { status: 403 }
            )
          }
        }
      }

      // Get Payload instance with provided config
      const config = await payloadConfig
      const payload = await getPayload({ config })

      // Handle homepage swap - if swapHomepage is true and isHomepage is being set,
      // unset the existing homepage first
      const access = await resolveAccess(authResult, request)

      if (swapHomepage && isHomepage === true) {
        const existingHomepage = await payload.find({
          collection,
          ...access(),
          where: {
            and: [
              { isHomepage: { equals: true } },
              { id: { not_equals: id } },
            ],
          },
          limit: 1,
          depth: 0,
        })

        if (existingHomepage.docs.length > 0) {
          await payload.update({
            collection,
            ...access(),
            id: existingHomepage.docs[0].id as string,
            data: { isHomepage: false },
            // Pass context to skip the uniqueness hook on this update
            context: { skipIsHomepageHook: true },
          })
        }
      }

      // Extract root props from puckData for syncing to Payload fields
      const rootProps =
        (puckData?.root as { props?: Record<string, unknown> })?.props || {}

      // Build update data starting with editorVersion
      const updateData: Record<string, unknown> = {
        editorVersion: 'puck',
      }

      // Add puckData if provided
      if (puckData) {
        updateData.puckData = puckData
      }

      // Map root.props to Payload fields
      const mappedFields = mapRootPropsToPayloadFields(rootProps, rootPropsMapping)

      // Merge mapped fields into update data (deep merge for nested objects)
      deepMerge(updateData, mappedFields)

      // Explicit title/slug override the mapped values
      if (title !== undefined) {
        updateData.title = title
      }
      if (slug !== undefined) {
        updateData.slug = slug
      }

      // Homepage flag: explicit isHomepage overrides the mapped value
      if (isHomepage !== undefined) {
        updateData.isHomepage = isHomepage
      }

      // Page-tree integration: explicit folder/pageSegment override the mapped values
      if (folder !== undefined) {
        updateData.folder = folder
      }
      if (pageSegment !== undefined) {
        updateData.pageSegment = pageSegment
      }

      // Set status if provided (for explicit publish)
      if (status) {
        updateData._status = status
      }

      // Call payload.update with draft parameter for Payload's versions.drafts system
      // When _status is set to 'published', the document is published regardless of draft param
      // When draft=true and no _status set, saves without publishing
      // When draft=false or omitted, updates the main collection
      const updateOptions: {
        collection: string
        id: string
        data: Record<string, unknown>
        draft?: boolean
      } & PayloadAccessArgs = {
        collection,
        ...access(),
        id,
        data: updateData,
      }

      // Only pass draft: true when explicitly saving as draft (not publishing)
      // When publishing (_status: 'published'), we omit the draft option entirely
      // to let Payload handle it correctly
      if (draft === true && status !== 'published') {
        updateOptions.draft = true
      }

      const updatedPage = await payload.update(updateOptions)

      return NextResponse.json({ doc: updatedPage })
    } catch (error) {
      const params = await context.params
      if (onError) {
        onError(error, { operation: 'update', request, pageId: params.id })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error updating page:', error)

      // Handle Payload validation errors gracefully
      if (error instanceof Error && error.name === 'ValidationError') {
        const validationError = error as Error & {
          data?: { errors?: Array<{ field: string; message: string }> }
        }
        const fieldErrors = validationError.data?.errors || []

        // Check for common validation issues and provide friendly messages
        const slugError = fieldErrors.find((e) => e.field === 'slug')
        if (slugError) {
          return NextResponse.json(
            {
              error: 'A page with this slug already exists. Please choose a different slug.',
              field: 'slug',
              details: fieldErrors,
            },
            { status: 400 }
          )
        }

        // Generic validation error
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
        { error: 'Failed to update page' },
        { status: 500 }
      )
    }
  }

  /**
   * DELETE /api/puck/pages/[id]
   * Delete a page by ID
   */
  async function DELETE(
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

      // Check delete permission
      if (auth.canDelete) {
        const permission = await auth.canDelete(authResult.user, id)
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

      const access = await resolveAccess(authResult, request)

      await payload.delete({
        collection,
        ...access(),
        id,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      const params = await context.params
      if (onError) {
        onError(error, { operation: 'delete', request, pageId: params.id })
      }
      const misconfigured = accessMisconfigurationResponse(error)
      if (misconfigured) return misconfigured
      console.error('Error deleting page:', error)
      // An access denial is a 403, not a server fault. Mapping it keeps the
      // access-control layer visible to clients and out of error monitoring.
      const mapped = payloadErrorResponse(error)
      if (mapped) return mapped

      return NextResponse.json(
        { error: 'Failed to delete page' },
        { status: 500 }
      )
    }
  }

  return { GET, PATCH, DELETE }
}
