import type { CollectionBeforeChangeHook } from 'payload'
import { APIError } from 'payload'

/**
 * Information about an existing homepage page
 */
export interface ExistingHomepageInfo {
  id: string
  title: string
  slug: string
}

/**
 * Error thrown when attempting to set a second page as homepage.
 * Contains information about the existing homepage for client-side handling.
 */
export class HomepageConflictError extends APIError {
  existingHomepage: ExistingHomepageInfo

  constructor(existingHomepage: ExistingHomepageInfo) {
    super(
      `Another page is already set as homepage: "${existingHomepage.title}" (/${existingHomepage.slug})`,
      400,
      // Pass existingHomepage in the data parameter so it appears in the API response
      { existingHomepage },
      true // isPublic - allows the message to be shown to the client
    )
    this.name = 'HomepageConflictError'
    this.existingHomepage = existingHomepage
  }
}

/**
 * Options for the isHomepage uniqueness hook
 */
export interface IsHomepageUniqueHookOptions {
  /**
   * Collection slug to query for existing homepage.
   * Defaults to the current collection.
   */
  collectionSlug?: string
}

/**
 * Creates a beforeChange hook that ensures only one page can have isHomepage: true.
 *
 * When a user tries to set isHomepage to true on a page, this hook:
 * 1. Checks if another page already has isHomepage: true
 * 2. If found, throws a HomepageConflictError with the existing page info
 * 3. The client can then prompt the user to swap homepages
 *
 * @example
 * ```typescript
 * import { createIsHomepageUniqueHook } from '@delmaredigital/payload-puck/plugin'
 *
 * const Pages: CollectionConfig = {
 *   slug: 'pages',
 *   hooks: {
 *     beforeChange: [createIsHomepageUniqueHook()],
 *   },
 *   fields: [...],
 * }
 * ```
 */
export function createIsHomepageUniqueHook(
  options: IsHomepageUniqueHookOptions = {}
): CollectionBeforeChangeHook {
  return async ({ data, originalDoc, req, collection, context }) => {
    // Skip if explicitly bypassed (used during homepage swap)
    if (context?.skipIsHomepageHook) {
      return data
    }

    // Only check if isHomepage is being set to true
    const isSettingHomepage = data?.isHomepage === true
    const wasHomepage = originalDoc?.isHomepage === true

    // Skip if not setting as homepage, or if it was already homepage
    if (!isSettingHomepage || wasHomepage) {
      return data
    }

    const collectionSlug = options.collectionSlug || collection.slug
    // Use locale from context (passed by endpoint handler) or fall back to req.locale
    const locale = context?.locale || req.locale

    // Query for existing homepage (excluding current document).
    //
    // `overrideAccess: true` is deliberate. This hook runs *inside* an operation
    // whose access Payload already checked, and it enforces a global invariant:
    // only one page may be the homepage. Evaluating it against the editing user's
    // read rules would let someone create a second homepage merely because they
    // cannot see the first — a correctness bug, not a safeguard.
    const existingHomepage = await req.payload.find({
      collection: collectionSlug,
      overrideAccess: true,
      ...(locale ? { locale: locale.toString() } : {}),
      where: {
        and: [
          { isHomepage: { equals: true } },
          // Exclude current document if it has an ID
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
      limit: 1,
      depth: 0,
    })

    if (existingHomepage.docs.length > 0) {
      const existing = existingHomepage.docs[0] as {
        id: string
        title?: string
        slug?: string
      }

      throw new HomepageConflictError({
        id: String(existing.id),
        title: existing.title || 'Untitled',
        slug: existing.slug || '',
      })
    }

    return data
  }
}

/**
 * Unsets isHomepage on the specified page.
 * Used when swapping homepages.
 */
export async function unsetHomepage(
  payload: any,
  collectionSlug: string,
  pageId: string,
  locale?: string
): Promise<void> {
  // Deliberate, for the same reason as the uniqueness query above: unsetting the
  // previous homepage is invariant maintenance on behalf of an already-authorized
  // edit, not a user-initiated write to that document.
  await payload.update({
    collection: collectionSlug,
    overrideAccess: true,
    id: pageId,
    data: {
      isHomepage: false,
    },
    // Skip hooks to avoid infinite loops
    context: {
      skipIsHomepageHook: true,
    },
    ...(locale ? { locale: locale.toString() } : {}),
  })
}
