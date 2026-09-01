import type { NextRequest } from 'next/server'
import type { Data as PuckData } from '@puckeditor/core'

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * Authenticated user from the auth system
 *
 * This is deliberately loose: `authenticate` may return a Better Auth session
 * user, a NextAuth user, a decoded JWT payload, or a Payload user. It is used
 * for the `canX` route-gating hooks.
 *
 * It is **not** what Payload evaluates access control against — see
 * {@link PayloadUser}.
 */
export interface AuthenticatedUser {
  id: string
  [key: string]: unknown
}

/**
 * A Payload user document, as Payload's access-control functions expect to
 * receive it on `req.user`.
 *
 * The `collection` property is what distinguishes a real Payload user from an
 * arbitrary session object — Payload stamps it onto the user during
 * authentication (`BaseUser` in `payload/auth/types`). Access rules such as
 * `({ req }) => req.user?.role === 'admin'` are evaluated against this document.
 */
export interface PayloadUser {
  id: string | number
  collection: string
  [key: string]: unknown
}

/**
 * Result of an authentication check
 */
export interface AuthResult {
  authenticated: boolean
  user?: AuthenticatedUser

  /**
   * The Payload user document this request should act as when Payload evaluates
   * collection and field access control.
   *
   * Set this when `authenticate` already knows the Payload user — it saves the
   * route factory a second lookup via {@link PuckApiAuthHooks.toPayloadUser}.
   *
   * - A user document → access control is evaluated as that user.
   * - `null` → access control is evaluated as an anonymous/public request.
   * - Omitted (`undefined`) → the factory falls back to `toPayloadUser`, then to
   *   `user` if it is structurally a Payload user, and otherwise fails closed.
   *
   * If `authenticate` returns a Payload user as `user` (i.e. the result of
   * `payload.auth()`), you do not need to set this at all.
   */
  payloadUser?: PayloadUser | null

  error?: string
}

/**
 * Result of a permission check
 */
export interface PermissionResult {
  allowed: boolean
  error?: string
}

// =============================================================================
// Auth Hooks Interface
// =============================================================================

/**
 * Authentication and authorization hooks for Puck API routes
 *
 * These hooks allow you to integrate with any authentication system
 * (Better Auth, NextAuth, Payload auth, custom JWT, etc.)
 *
 * @example
 * ```typescript
 * // Payload's own auth — nothing else to wire up, because `user` already is a
 * // Payload user document and access control can be evaluated directly.
 * const authHooks: PuckApiAuthHooks = {
 *   authenticate: async (request) => {
 *     const payload = await getPayload({ config })
 *     const { user } = await payload.auth({ headers: request.headers })
 *     if (!user) return { authenticated: false }
 *     return { authenticated: true, user }
 *   },
 * }
 * ```
 *
 * @example
 * ```typescript
 * // External auth (Better Auth shown) — `toPayloadUser` is required, otherwise
 * // the factory cannot tell what the caller may do inside Payload.
 * const authHooks: PuckApiAuthHooks = {
 *   authenticate: async (request) => {
 *     const session = await auth.api.getSession({ headers: request.headers })
 *     if (!session?.user) return { authenticated: false }
 *     return { authenticated: true, user: session.user }
 *   },
 *   toPayloadUser: async (user) => {
 *     const payload = await getPayload({ config })
 *     const { docs } = await payload.find({
 *       collection: 'users',
 *       where: { email: { equals: user.email as string } },
 *       limit: 1,
 *       overrideAccess: true,
 *     })
 *     return docs[0] ?? null
 *   },
 *   canEdit: async (user, pageId) => {
 *     return { allowed: hasRole(user, 'editor') }
 *   },
 * }
 * ```
 */
export interface PuckApiAuthHooks {
  /**
   * Authenticate the incoming request
   * Should return the authenticated user or authentication failure
   */
  authenticate: (request: NextRequest) => Promise<AuthResult>

  /**
   * Map the authenticated user onto the Payload user document that Payload's
   * collection and field access rules should be evaluated against.
   *
   * Required whenever `authenticate` returns something that is not a Payload
   * user (a Better Auth session, a NextAuth user, a decoded JWT, ...). Without
   * it the route factory has no way to know what privileges the caller holds
   * inside Payload, and fails closed with a 500 rather than guessing.
   *
   * Return `null` to deliberately evaluate access control as an anonymous
   * (public) request.
   *
   * @example
   * ```typescript
   * toPayloadUser: async (user) => {
   *   const { docs } = await payload.find({
   *     collection: 'users',
   *     where: { email: { equals: user.email as string } },
   *     limit: 1,
   *     overrideAccess: true, // this lookup is the trusted mapping step
   *   })
   *   return docs[0] ?? null
   * }
   * ```
   */
  toPayloadUser?: (
    user: AuthenticatedUser,
    request: NextRequest
  ) => Promise<PayloadUser | null> | PayloadUser | null

  /**
   * Check if user can list pages
   *
   * This is coarse route gating layered *on top of* Payload's collection access
   * rules, which are always enforced (unless explicitly disabled via
   * `dangerouslyDisableCollectionAccessControl`). Omitting it does not grant
   * access Payload itself would deny.
   *
   * @default No additional restriction beyond Payload collection access
   */
  canList?: (
    user: AuthenticatedUser
  ) => Promise<PermissionResult> | PermissionResult

  /**
   * Check if user can view a specific page
   * @default No additional restriction beyond Payload collection access
   */
  canView?: (
    user: AuthenticatedUser,
    pageId: string
  ) => Promise<PermissionResult> | PermissionResult

  /**
   * Check if user can create new pages
   * @default No additional restriction beyond Payload collection access
   */
  canCreate?: (
    user: AuthenticatedUser
  ) => Promise<PermissionResult> | PermissionResult

  /**
   * Check if user can edit a specific page
   * @default No additional restriction beyond Payload collection access
   */
  canEdit?: (
    user: AuthenticatedUser,
    pageId: string
  ) => Promise<PermissionResult> | PermissionResult

  /**
   * Check if user can publish a specific page (change status to published)
   * @default Falls back to canEdit, then to Payload collection access
   */
  canPublish?: (
    user: AuthenticatedUser,
    pageId: string
  ) => Promise<PermissionResult> | PermissionResult

  /**
   * Check if user can delete a specific page
   * @default No additional restriction beyond Payload collection access
   */
  canDelete?: (
    user: AuthenticatedUser,
    pageId: string
  ) => Promise<PermissionResult> | PermissionResult
}

// =============================================================================
// Root Props Mapping Types
// =============================================================================

/**
 * Mapping configuration for syncing Puck root.props to Payload fields
 *
 * @example
 * ```typescript
 * // Simple mapping
 * { from: 'pageLayout', to: 'pageLayout' }
 *
 * // Nested field mapping (uses official @payloadcms/plugin-seo convention)
 * { from: 'title', to: 'meta.title' }
 *
 * // With transformation
 * {
 *   from: 'publishDate',
 *   to: 'publishedAt',
 *   transform: (value) => value ? new Date(value as string).toISOString() : null
 * }
 * ```
 */
export interface RootPropsMapping {
  /**
   * Property name in Puck root.props
   */
  from: string

  /**
   * Field path in Payload document (supports dot notation for nested fields)
   */
  to: string

  /**
   * Optional transformation function
   */
  transform?: (value: unknown) => unknown
}

// =============================================================================
// API Routes Configuration
// =============================================================================

/**
 * Error context passed to onError callback
 */
export interface ErrorContext {
  operation: string
  request: NextRequest
  pageId?: string
}

/**
 * Configuration for Puck API routes
 *
 * @example
 * ```typescript
 * const config: PuckApiRoutesConfig = {
 *   collection: 'pages',
 *   auth: {
 *     authenticate: async (request) => {
 *       // Your auth logic here
 *     },
 *     canPublish: async (user) => {
 *       return { allowed: user.role === 'admin' }
 *     },
 *   },
 *   rootPropsMapping: [
 *     { from: 'title', to: 'meta.title' },
 *     { from: 'description', to: 'meta.description' },
 *   ],
 *   enableDrafts: true,
 * }
 * ```
 */
export interface PuckApiRoutesConfig {
  /**
   * Payload collection slug for pages
   * @default 'pages'
   */
  collection?: string

  /**
   * Payload configuration - import from @payload-config
   * Required for Turbopack/Next.js 16+ compatibility
   *
   * @example
   * ```typescript
   * import config from '@payload-config'
   *
   * createPuckApiRoutesWithId({
   *   payloadConfig: config,
   *   // ...
   * })
   * ```
   */
  payloadConfig: Promise<import('payload').SanitizedConfig>

  /**
   * Authentication and authorization hooks
   */
  auth: PuckApiAuthHooks

  /**
   * Custom mappings from Puck root.props to Payload fields
   * These are merged with the default mappings
   */
  rootPropsMapping?: RootPropsMapping[]

  /**
   * Default Puck data for new pages
   */
  defaultPuckData?: PuckData

  /**
   * Enable draft mode for page creation/updates
   * @default true
   */
  enableDrafts?: boolean

  /**
   * Custom error handler for logging/monitoring
   */
  onError?: (error: unknown, context: ErrorContext) => void

  /**
   * **SECURITY — do not enable without understanding the consequence.**
   *
   * Restores the pre-0.9.0 behaviour in which these routes called Payload's
   * Local API with `overrideAccess: true`, so collection `access` rules and
   * field-level access are **not** evaluated. Your `canX` hooks become the only
   * authorization in front of read, create, update, publish, delete and version
   * restore.
   *
   * This was the vulnerability described in GHSA-957g-hmmp-rchg. The only
   * legitimate reason to set it is an emergency rollback while you wire up
   * {@link PuckApiAuthHooks.toPayloadUser}. Setting it logs a warning once per
   * route factory.
   *
   * @default false
   */
  dangerouslyDisableCollectionAccessControl?: true
}

// =============================================================================
// Route Handler Types
// =============================================================================

/**
 * Context passed to Next.js App Router route handlers
 */
export interface RouteHandlerContext {
  params: Promise<Record<string, string>>
}

/**
 * Context for route handlers that require an id parameter
 */
export interface RouteHandlerWithIdContext {
  params: Promise<{ id: string }>
}

/**
 * Next.js App Router route handler type
 */
export type RouteHandler = (
  request: NextRequest,
  context: RouteHandlerContext
) => Promise<Response>

/**
 * Next.js App Router route handler type for [id] routes
 */
export type RouteHandlerWithId = (
  request: NextRequest,
  context: RouteHandlerWithIdContext
) => Promise<Response>

/**
 * Route handlers returned by createPuckApiRoutes
 */
export interface PuckApiRouteHandlers {
  GET: RouteHandler
  POST: RouteHandler
}

/**
 * Route handlers returned by createPuckApiRoutesWithId
 */
export interface PuckApiRouteWithIdHandlers {
  GET: RouteHandlerWithId
  PATCH: RouteHandlerWithId
  DELETE: RouteHandlerWithId
}

// =============================================================================
// Request/Response Types
// =============================================================================

/**
 * Request body for creating a new page
 */
export interface CreatePageBody {
  title: string
  slug: string
  puckData?: PuckData
  status?: 'draft' | 'published'
}

/**
 * Request body for updating a page
 */
export interface UpdatePageBody {
  puckData?: PuckData
  title?: string
  slug?: string
  status?: 'draft' | 'published'
  /** Alias for status — the editor sends `_status` (Payload convention) */
  _status?: 'draft' | 'published'
  /**
   * When true, save as draft without publishing.
   * Used by Payload's versions.drafts system.
   */
  draft?: boolean
  /**
   * Mark this page as the homepage.
   * Consumers should check this flag first, then fall back to slug convention.
   */
  isHomepage?: boolean
  /**
   * When true and isHomepage is true, automatically unsets the existing homepage.
   * Used when the user confirms they want to swap homepages.
   */
  swapHomepage?: boolean
  /**
   * Folder ID for page-tree integration.
   * When page-tree plugin is active, this determines the page's parent folder.
   */
  folder?: string | null
  /**
   * Page segment for page-tree integration.
   * Combined with folder path to generate the full slug.
   */
  pageSegment?: string
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  doc?: T
  docs?: T[]
  error?: string
  success?: boolean
  totalDocs?: number
  totalPages?: number
  page?: number
  limit?: number
  hasPrevPage?: boolean
  hasNextPage?: boolean
}

// =============================================================================
// Version Types
// =============================================================================

/**
 * A version entry from Payload's versions system
 */
export interface PageVersion {
  id: string
  parent: string
  version: {
    title?: string
    slug?: string
    puckData?: PuckData
    _status?: 'draft' | 'published'
    updatedAt: string
    createdAt: string
  }
  createdAt: string
  updatedAt: string
  autosave?: boolean
  latest?: boolean
}

/**
 * Route handlers returned by createPuckApiRoutesVersions
 */
export interface PuckApiVersionsRouteHandlers {
  GET: RouteHandlerWithId
  POST: RouteHandlerWithId
}
