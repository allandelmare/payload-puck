/**
 * Puck API Endpoint Handlers
 *
 * These handlers are registered via config.endpoints in the plugin.
 * They provide CRUD operations for Puck-enabled collections.
 *
 * Access control: All handlers pass `overrideAccess: false` and `req` to
 * Payload's local API, so collection-level access rules are enforced.
 */

import type { PayloadHandler, CollectionSlug } from 'payload'
import { APIError } from 'payload'
import { unsetHomepage, HomepageConflictError } from '../plugin/hooks/isHomepageUnique.js'
import { resolveLocale } from '../utils/locale.js'
import { payloadErrorStatus } from '../utils/payloadErrors.js'
import { mapRootPropsToPayloadFields, deepMerge } from '../api/utils/mapRootProps.js'
import type { RootPropsMapping } from '../api/types.js'

export interface PuckEndpointOptions {
  collections: string[]
  /**
   * Custom root.props → Payload field mappings, merged with the defaults.
   * Lets fields edited via Puck root fields (e.g. conversionTracking) sync
   * back to their Payload columns on save/publish.
   */
  rootPropsMapping?: RootPropsMapping[]
}

/**
 * Merge a Puck save payload's `data` with the Payload fields derived from its
 * `puckData.root.props`.
 *
 * Mapped fields form the base; the explicitly-sent fields (puckData, title,
 * slug, isHomepage, folder, pageSegment) take precedence. Without this, fields
 * exposed as Puck root fields (e.g. conversionTracking, meta, pageLayout) are
 * persisted only inside the puckData blob and never reach their Payload
 * columns — so they appear to "revert" on publish. Mirrors the sync performed
 * by createPuckApiRoutesWithId's PATCH handler.
 */
function applyRootPropsMapping(
  data: Record<string, unknown>,
  rootPropsMapping?: RootPropsMapping[]
): Record<string, unknown> {
  const rootProps =
    (data?.puckData as { root?: { props?: Record<string, unknown> } } | undefined)?.root?.props || {}
  const mappedFields = mapRootPropsToPayloadFields(rootProps, rootPropsMapping)

  const merged: Record<string, unknown> = {}
  deepMerge(merged, mappedFields)
  deepMerge(merged, data)
  return merged
}

/**
 * GET /api/puck/:collection
 * List all documents in a Puck-enabled collection
 */
export function createListHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const locale = resolveLocale(req)

      const result = await req.payload.find({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        draft: true,
        depth: 0,
        limit: 100,
        ...(locale ? { locale } : {}),
      })

      return Response.json(result)
    } catch (error) {
      console.error('[payload-puck] List error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'List failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * POST /api/puck/:collection
 * Create a new document in a Puck-enabled collection
 */
export function createCreateHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections, rootPropsMapping } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const body = await req.json?.()
      const { _locale, ...data } = body || {}
      const locale = resolveLocale(req, _locale)

      const createData = applyRootPropsMapping(data, rootPropsMapping)

      const doc = await req.payload.create({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        data: createData,
        draft: true,
        ...(locale ? { locale } : {}),
      })

      return Response.json({ doc })
    } catch (error) {
      console.error('[payload-puck] Create error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Create failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * GET /api/puck/:collection/:id
 * Get a single document by ID
 */
export function createGetHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string
      const id = req.routeParams?.id as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const locale = resolveLocale(req)

      const doc = await req.payload.findByID({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        id,
        draft: true,
        depth: 0,
        ...(locale ? { locale } : {}),
      })

      return Response.json({ doc })
    } catch (error) {
      console.error('[payload-puck] Get error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Get failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * PATCH /api/puck/:collection/:id
 * Update a document (supports draft saving, publishing, and homepage swapping)
 */
export function createUpdateHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections, rootPropsMapping } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string
      const id = req.routeParams?.id as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const body = await req.json?.()
      const { _status, _locale, swapHomepage, ...data } = body || {}
      const locale = resolveLocale(req, _locale)

      // Determine if this is a publish or draft save
      const shouldPublish = _status === 'published'

      // Sync Puck root.props → Payload fields (e.g. conversionTracking, meta,
      // pageLayout) so values edited via Puck root fields persist to their
      // columns on publish instead of living only inside the puckData blob.
      const updateData = applyRootPropsMapping(data, rootPropsMapping)
      updateData._status = shouldPublish ? 'published' : 'draft'

      // Handle homepage swap if requested
      // When swapHomepage is true and isHomepage is being set to true,
      // we need to unset the current homepage first. Read the resolved value
      // from updateData so this works whether isHomepage arrived as a top-level
      // field or was mapped in from root.props.
      if (swapHomepage && updateData.isHomepage === true) {
        // Find the current homepage
        const existingHomepage = await req.payload.find({
          collection: collection as CollectionSlug,
          req,
          overrideAccess: false,
          where: {
            and: [
              { isHomepage: { equals: true } },
              { id: { not_equals: id } },
            ],
          },
          limit: 1,
          depth: 0,
          ...(locale ? { locale } : {}),
        })

        // Unset the existing homepage if found
        if (existingHomepage.docs.length > 0) {
          const existingId = String(existingHomepage.docs[0].id)
          await unsetHomepage(req.payload, collection, existingId, locale)
        }
      }

      const doc = await req.payload.update({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        id,
        data: updateData,
        draft: !shouldPublish,
        context: {
          // Skip the isHomepage hook if we've already handled the swap
          ...(swapHomepage && { skipIsHomepageHook: true }),
          // Pass locale to context so hooks can access it without re-reading body
          ...(locale && { locale }),
        },
        ...(locale ? { locale } : {}),
      })

      return Response.json({ doc, published: shouldPublish })
    } catch (error) {
      console.error('[payload-puck] Update error:', error)

      // Handle HomepageConflictError specially - pass through existingHomepage data
      if (error instanceof HomepageConflictError) {
        return Response.json(
          {
            error: error.message,
            data: { existingHomepage: error.existingHomepage },
          },
          { status: 400 }
        )
      }

      // Handle other APIErrors
      if (error instanceof APIError) {
        return Response.json(
          { error: error.message, data: error.data },
          { status: error.status || 500 }
        )
      }

      return Response.json(
        { error: error instanceof Error ? error.message : 'Update failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * DELETE /api/puck/:collection/:id
 * Delete a document
 */
export function createDeleteHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string
      const id = req.routeParams?.id as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      await req.payload.delete({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        id,
      })

      return Response.json({ success: true })
    } catch (error) {
      console.error('[payload-puck] Delete error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Delete failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * GET /api/puck/:collection/:id/versions
 * Get version history for a document
 */
export function createVersionsHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string
      const id = req.routeParams?.id as string
      const locale = resolveLocale(req)

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const versions = await req.payload.findVersions({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        where: {
          parent: { equals: id },
        },
        sort: '-updatedAt',
        limit: 20,
        ...(locale ? { locale, fallbackLocale: false } : {}),
      })

      return Response.json({ versions: versions.docs })
    } catch (error) {
      console.error('[payload-puck] Versions error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Versions failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}

/**
 * POST /api/puck/:collection/:id/restore
 * Restore a specific version
 */
export function createRestoreHandler(options: PuckEndpointOptions): PayloadHandler {
  const { collections } = options

  return async (req) => {
    try {
      const collection = req.routeParams?.collection as string
      const id = req.routeParams?.id as string

      if (!collections.includes(collection)) {
        return Response.json(
          { error: `Collection '${collection}' is not configured for Puck` },
          { status: 400 }
        )
      }

      const body = await req.json?.()
      const { versionId, locale } = body || {}

      if (!versionId) {
        return Response.json(
          { error: 'Missing versionId in request body' },
          { status: 400 }
        )
      }

      const doc = await req.payload.restoreVersion({
        collection: collection as CollectionSlug,
        req,
        overrideAccess: false,
        id: versionId,
        ...(locale ? { locale: locale.toString() } : {}),
      })

      return Response.json({ doc })
    } catch (error) {
      console.error('[payload-puck] Restore error:', error)
      return Response.json(
        { error: error instanceof Error ? error.message : 'Restore failed' },
        { status: payloadErrorStatus(error) ?? 500 }
      )
    }
  }
}
