import type { Access, CollectionConfig, Config as PayloadConfig, Field } from 'payload'
import type { Config as PuckConfig, Data as PuckData } from '@puckeditor/core'
import type { ThemeConfig } from '../theme/types.js'
import type { LayoutDefinition, LayoutConfig } from '../layouts/types.js'
import type { PuckPluginAiConfig, AiExamplePrompt } from '../ai/types.js'
import type { RootPropsMapping } from '../api/types.js'

// =============================================================================
// Plugin Configuration Types
// =============================================================================

/**
 * Admin UI configuration for the Puck plugin
 */
export interface PuckAdminConfig {
  /**
   * Whether to add the visual editor button to the collection
   * @default true
   */
  addEditButton?: boolean

  /**
   * Custom URL pattern for the Puck editor (for backwards compatibility)
   * By default, the plugin uses the integrated admin view at /admin/puck-editor/:collection/:id
   * Use {id} as placeholder for document ID, {collection} for collection slug
   * @deprecated The editor is now integrated into Payload admin. Only use this for custom external editors.
   */
  editorPathPattern?: string

  /**
   * Button label text
   * @default 'Visual Editor'
   */
  buttonLabel?: string

  /**
   * Position of the edit button in admin sidebar
   * @default 'sidebar'
   */
  buttonPosition?: 'sidebar' | 'main'
}

/**
 * Configuration options for the Puck plugin
 */
export interface PuckPluginOptions {
  /**
   * Collection slug for pages
   * @default 'pages'
   */
  pagesCollection?: string

  /**
   * Whether to auto-generate the Pages collection
   * Set to false if you want to define your own collection
   * @default true
   */
  autoGenerateCollection?: boolean

  /**
   * Custom collection config to merge with defaults
   */
  collectionOverrides?: Partial<CollectionConfig>

  /**
   * Access control for the generated pages collection.
   * Uses Payload's Access type for full compatibility.
   *
   * Defaults: `read` allows everyone; `create`, `update` and `delete` require
   * an authenticated Payload user (`({ req }) => Boolean(req.user)`). Pass your
   * own functions to tighten this, e.g. `update: ({ req }) => req.user?.role === 'admin'`.
   */
  access?: {
    read?: Access
    create?: Access
    update?: Access
    delete?: Access
  }

  /**
   * Page layout configuration
   * Define custom layouts that affect how page content is rendered
   * @default DEFAULT_LAYOUTS
   */
  layouts?: LayoutDefinition[]

  /**
   * Additional fields to add to the Pages collection
   */
  additionalFields?: Field[]

  /**
   * Admin UI configuration
   * Configure how the visual editor integrates with Payload admin
   */
  admin?: PuckAdminConfig

  /**
   * Theme configuration for customizing button styles, colors, and presets
   * All values are optional and will fall back to defaults
   */
  theme?: ThemeConfig

  /**
   * Whether to enable the integrated admin view
   * When enabled, the Puck editor is accessible at /admin/puck-editor/:collection/:id
   * @default true
   */
  enableAdminView?: boolean

  /**
   * Custom path for the admin view (without /admin prefix)
   * @default '/puck-editor'
   */
  adminViewPath?: string

  /**
   * Whether to enable built-in API endpoints
   * When enabled, endpoints are registered at /api/puck/:collection/:id
   * @default true
   */
  enableEndpoints?: boolean

  /**
   * Custom mappings from Puck `root.props` to Payload collection fields.
   *
   * Merged with the built-in defaults (title, slug, meta.*, pageLayout,
   * conversionTracking.*, etc.). Applied in both directions: Payload field →
   * root.prop when loading the editor, and root.prop → Payload field when
   * saving/publishing, so values edited via Puck root fields persist to their
   * columns instead of living only inside the puckData blob.
   */
  rootPropsMapping?: RootPropsMapping[]

  /**
   * Integration with @delmaredigital/payload-page-tree plugin
   *
   * **Auto-detection:** The Puck editor automatically detects if page-tree is active
   * by checking for the `pageSegment` field on the collection. No configuration needed
   * in most cases.
   *
   * Use this option only if you need to:
   * - Explicitly disable page-tree integration: `pageTreeIntegration: false`
   * - Override default field names if you customized page-tree config
   *
   * @example
   * ```typescript
   * // Usually not needed - auto-detected!
   * createPuckPlugin({
   *   pagesCollection: 'pages',
   * })
   *
   * // Override field names if customized:
   * createPuckPlugin({
   *   pageTreeIntegration: {
   *     folderSlug: 'my-folders',
   *     pageSegmentFieldName: 'urlSegment',
   *   },
   * })
   *
   * // Explicitly disable even if page-tree is present:
   * createPuckPlugin({
   *   pageTreeIntegration: false,
   * })
   * ```
   */
  pageTreeIntegration?: boolean | PageTreeIntegrationOptions

  /**
   * Stylesheet URLs to load inside the editor preview iframe, in order.
   *
   * These are plain URLs the browser fetches — a static file your build emits,
   * or any external stylesheet. The plugin does not compile CSS: your app's own
   * toolchain already does that far better than we can, and compiling it a
   * second time was the source of a dev/production split where the editor
   * looked correct locally and unstyled in production.
   *
   * Generate the file with Tailwind's own CLI as part of your build, so the
   * editor loads byte-identical CSS in every environment:
   *
   * ```jsonc
   * // package.json
   * {
   *   "scripts": {
   *     "build:puck-css": "tailwindcss -i ./src/app/(frontend)/globals.css -o ./public/puck-editor-styles.css",
   *     "build": "pnpm build:puck-css && next build",
   *     "dev": "pnpm build:puck-css --watch & next dev"
   *   }
   * }
   * ```
   *
   * ```typescript
   * createPuckPlugin({
   *   editorStylesheets: [
   *     '/puck-editor-styles.css',
   *     'https://fonts.googleapis.com/css2?family=Inter:wght@400;700',
   *   ],
   * })
   * ```
   *
   * Resolved URLs are published on `config.custom.puck.editorStylesheets` and
   * passed to the editor automatically — you do not need to repeat them on
   * `PuckConfigProvider`.
   *
   * @example ['/puck-editor-styles.css']
   */
  editorStylesheets?: string[]

  /**
   * AI configuration for the plugin.
   * Enables AI-powered page generation in the editor.
   *
   * @example
   * ```typescript
   * createPuckPlugin({
   *   ai: {
   *     enabled: true,
   *     context: 'We are Acme Corp. You build our landing pages.',
   *     promptsCollection: true, // Auto-create puck-ai-prompts collection
   *   },
   * })
   * ```
   */
  ai?: PuckPluginAiConfig

  /**
   * Preview URL for the "View" button in the editor.
   *
   * Can be:
   * - A string: Static URL prefix (e.g., '/' or '/preview')
   * - A function receiving the page document: Returns a string prefix or a slug-to-URL function
   *
   * **RSC Serialization:** Since PuckEditorView is a React Server Component, functions
   * cannot be passed directly to the client. Instead, the server:
   * 1. Calls your function with the page document
   * 2. If the result is a function, calls it with `''` (empty string) to extract the base prefix
   * 3. Passes the string prefix to the client, which reconstructs the URL function
   *
   * **Important:** When returning a function, it MUST return just the prefix when called
   * with an empty/falsy slug. Use this pattern:
   * ```typescript
   * return (slug) => slug ? `/${prefix}/${slug}` : `/${prefix}`
   * ```
   *
   * @example
   * ```typescript
   * // Simple static prefix (pages at /about, /contact, etc.)
   * previewUrl: '/'
   *
   * // Dynamic prefix based on page data (org-scoped pages)
   * previewUrl: (page) => {
   *   const orgSlug = page.organization?.slug || 'default'
   *   // Return a function - MUST return just prefix when slug is empty
   *   return (slug) => slug ? `/${orgSlug}/${slug}` : `/${orgSlug}`
   * }
   *
   * // Or return the prefix string directly
   * previewUrl: (page) => `/${page.organization?.slug || 'default'}`
   * ```
   */
  previewUrl?: string | ((page: any) => string | ((slug: string) => string))
}

/**
 * Configuration options for page-tree integration
 */
export interface PageTreeIntegrationOptions {
  /**
   * Collection slug for folders
   * @default 'payload-folders'
   */
  folderSlug?: string

  /**
   * Field name for folder path segments
   * @default 'pathSegment'
   */
  segmentFieldName?: string

  /**
   * Field name for page segments
   * @default 'pageSegment'
   */
  pageSegmentFieldName?: string

  /**
   * Field name for the folder relationship
   * @default 'folder'
   */
  folderFieldName?: string
}

// =============================================================================
// Page Data Types
// =============================================================================

/**
 * Root properties for a Puck page
 */
export interface PuckRootProps {
  title?: string
  pageLayout?: string
  [key: string]: unknown
}

/**
 * Complete Puck page data structure
 */
export interface PuckPageData extends PuckData {
  root: {
    props: PuckRootProps
  }
}

/**
 * SEO/Meta configuration for a page.
 * Uses the official @payloadcms/plugin-seo convention.
 */
export interface PageMeta {
  title?: string
  description?: string
  image?: string | { id: string; url: string; alt?: string }
  noindex?: boolean
  nofollow?: boolean
  excludeFromSitemap?: boolean
}

/**
 * @deprecated Use PageMeta instead. This alias is kept for backwards compatibility.
 */
export type PageSEO = PageMeta

/**
 * Conversion type options
 */
export type ConversionType =
  | 'lead'
  | 'registration'
  | 'purchase'
  | 'donation'
  | 'newsletter'
  | 'contact'
  | 'custom'

/**
 * Conversion tracking configuration for a page
 */
export interface PageConversionTracking {
  isConversionPage?: boolean
  conversionType?: ConversionType
  conversionValue?: number
}

/**
 * Editor version options
 */
export type EditorVersion = 'legacy' | 'puck'

/**
 * Page document from Payload
 */
export interface PageDocument {
  id: string
  title: string
  slug: string
  pageLayout: string
  editorVersion?: EditorVersion
  isHomepage: boolean
  puckData: PuckPageData | null
  meta?: PageMeta
  conversionTracking?: PageConversionTracking
  createdAt: string
  updatedAt: string
  _status?: 'draft' | 'published'
  // Page-tree fields (when pageTreeIntegration is enabled)
  folder?: string | { id: string; name?: string; pathSegment?: string }
  pageSegment?: string
}

/**
 * Puck root props when page-tree integration is enabled
 */
export interface PageTreeRootProps extends PuckRootProps {
  folder?: string | null
  pageSegment?: string
}

// =============================================================================
// Component Types
// =============================================================================

/**
 * Shared props for all Puck components
 */
export interface SharedComponentProps {
  id?: string
  maxWidth?: 'narrow' | 'medium' | 'wide' | 'full'
  verticalPadding?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  visibility?: 'always' | 'authenticated' | 'guest'
}

/**
 * Media object from Payload
 */
export interface MediaObject {
  id: string
  url: string
  alt?: string
  width?: number
  height?: number
  filename?: string
  mimeType?: string
  sizes?: {
    thumbnail?: { url: string; width: number; height: number }
    medium?: { url: string; width: number; height: number }
    large?: { url: string; width: number; height: number }
  }
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Options for merging Puck configurations
 */
export interface MergeConfigOptions {
  /**
   * Base config to extend
   */
  base: PuckConfig

  /**
   * Additional components to add
   */
  components?: PuckConfig['components']

  /**
   * Additional categories to add/merge
   */
  categories?: PuckConfig['categories']

  /**
   * Root config overrides
   */
  root?: Partial<PuckConfig['root']>

  /**
   * Components to exclude from base
   */
  exclude?: string[]
}

// =============================================================================
// Field Types
// =============================================================================

/**
 * Props for the MediaField custom field
 */
export interface MediaFieldProps {
  value: MediaObject | string | null
  onChange: (value: MediaObject | string | null) => void
  label?: string
  allowedTypes?: string[]
}

/**
 * Props for the ColorPickerField custom field
 */
export interface ColorPickerFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  showOpacity?: boolean
}

// =============================================================================
// Re-exports from Puck
// =============================================================================

export type { Config as PuckConfig, Data as PuckData } from '@puckeditor/core'
export type { ThemeConfig } from '../theme/types.js'

// =============================================================================
// Re-exports for Hybrid Integration
// =============================================================================

export type { GetPuckFieldsOptions } from '../plugin/fields/types.js'

// Re-export AI types for convenience
export type { PuckPluginAiConfig, AiExamplePrompt } from '../ai/types.js'
