'use client'

import { useState, useCallback, useMemo, useRef, type ReactNode, createElement, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Puck, type Config as PuckConfig, type Data, type Plugin as PuckPlugin, type Overrides as PuckOverrides } from '@puckeditor/core'
import { useLocale } from '@payloadcms/ui'
import '@puckeditor/core/puck.css'
import headingAnalyzer from '@puckeditor/plugin-heading-analyzer'
import '@puckeditor/plugin-heading-analyzer/dist/index.css'
import { createAiPlugin } from '@puckeditor/plugin-ai'
import '@puckeditor/plugin-ai/styles.css'
import './ai-plugin-overrides.css'

import { Maximize2 } from 'lucide-react'
import { HeaderActions } from './components/HeaderActions.js'
import { IframeWrapper, type LayoutStyle } from './components/IframeWrapper.js'
import { PreviewModal } from './components/PreviewModal.js'
import { DarkModeStyles } from './components/DarkModeStyles.js'
import { useUnsavedChanges } from './hooks/useUnsavedChanges.js'
import { isDataEqual } from './utils/isDataEqual.js'
import { createVersionHistoryPlugin } from './plugins/versionHistoryPlugin.js'
import { ThemeProvider, type ThemeConfig } from '../theme/index.js'
import { usePuckConfig } from '../views/PuckConfigContext.js'
import type { LayoutDefinition } from '../layouts/index.js'
import type { AiExamplePrompt } from '../ai/types.js'
import { useAiPrompts } from '../ai/hooks/useAiPrompts.js'

/**
 * Default viewports for responsive preview
 */
const DEFAULT_VIEWPORTS = [
  {
    width: 360,
    height: 'auto' as const,
    label: 'Mobile',
    icon: 'Smartphone' as const,
  },
  {
    width: 768,
    height: 'auto' as const,
    label: 'Tablet',
    icon: 'Tablet' as const,
  },
  {
    width: 1280,
    height: 'auto' as const,
    label: 'Desktop',
    icon: 'Monitor' as const,
  },
  {
    width: '100%' as const,
    height: 'auto' as const,
    label: 'Full Width',
    icon: createElement(Maximize2, { size: 16 }),
  },
]

/**
 * Extended Data type to include our root props
 */
interface PuckDataWithMeta extends Data {
  root: {
    props?: {
      title?: string
      slug?: string
      pageLayout?: string
      // Page-tree integration fields
      folder?: string | null
      pageSegment?: string
      // Homepage field
      isHomepage?: boolean
      [key: string]: unknown
    }
  }
}

export interface PuckEditorImplProps {
  /**
   * Page ID for save operations
   */
  pageId: string
  /**
   * Initial Puck data to load
   */
  initialData: Data
  /**
   * Puck configuration with components and settings
   */
  config: PuckConfig
  /**
   * Page title for display
   */
  pageTitle: string
  /**
   * Page slug for preview URL
   */
  pageSlug: string
  /**
   * API endpoint for save operations
   * @default '/api/puck/pages'
   */
  apiEndpoint?: string
  /**
   * URL to navigate to when back button is clicked
   */
  backUrl?: string
  /**
   * Preview URL or function to generate preview URL from slug
   */
  previewUrl?: string | ((slug: string) => string)
  /**
   * Whether to enable viewport switching
   * @default true
   */
  enableViewports?: boolean
  /**
   * Additional Puck plugins to use.
   * The headingAnalyzer plugin is included by default.
   * Set to `false` to disable all default plugins.
   */
  plugins?: PuckPlugin[] | false
  /**
   * Layout definitions for the editor preview.
   * The editor reads header, footer, editorBackground, and editorDarkMode
   * from the layout definition matching the selected pageLayout.
   */
  layouts?: LayoutDefinition[]
  /**
   * Layout style configurations for theme-aware preview
   * @deprecated Use `layouts` prop instead. layoutStyles will be removed in a future version.
   */
  layoutStyles?: Record<string, LayoutStyle>
  /**
   * Key in root.props to read layout value from
   * @default 'pageLayout'
   */
  layoutKey?: string
  /**
   * Custom actions to render at the start of the header
   */
  headerActionsStart?: ReactNode
  /**
   * Custom actions to render at the end of the header
   */
  headerActionsEnd?: ReactNode
  /**
   * Puck overrides to merge with defaults
   */
  overrides?: Partial<PuckOverrides>
  /**
   * Callback on successful save
   */
  onSaveSuccess?: (data: Data) => void
  /**
   * Callback on save error
   */
  onSaveError?: (error: Error) => void
  /**
   * Callback when data changes
   */
  onChange?: (data: Data) => void
  /**
   * Initial document status from Payload (_status field)
   * Used to show draft/published badge in the header
   */
  initialStatus?: 'draft' | 'published'

  /**
   * Theme configuration for customizing component styles
   * When provided, components will use themed styles
   */
  theme?: ThemeConfig

  /**
   * Stylesheet URLs to inject into the editor iframe.
   * Merged with stylesheets from PuckConfigProvider context.
   */
  editorStylesheets?: string[]
  /**
   * Raw CSS to inject into the editor iframe.
   * Merged with CSS from PuckConfigProvider context.
   */
  editorCss?: string

  // AI integration props

  /**
   * Enable AI features in the editor.
   * When true, adds the AI chat plugin.
   * @default false
   */
  enableAi?: boolean

  /**
   * AI plugin configuration options.
   * Only used when enableAi is true.
   */
  aiOptions?: {
    host?: string
    examplePrompts?: AiExamplePrompt[]
    prepareRequest?: (opts: {
      body?: { chatId?: string; trigger?: string; [key: string]: any }
      headers?: HeadersInit
      credentials?: RequestCredentials
    }) => any | Promise<any>
    scrollTracking?: boolean
  }

  /**
   * Whether the puck-ai-prompts collection is enabled.
   * When true, adds the prompt editor plugin to the plugin rail.
   * @default false
   */
  hasPromptsCollection?: boolean

  /**
   * Whether the puck-ai-context collection is enabled.
   * When true, adds the context editor plugin to the plugin rail.
   * @default false
   */
  hasContextCollection?: boolean

  /**
   * Enable experimental full screen canvas mode.
   * When enabled, the canvas takes up the full viewport with a floating viewport switcher.
   * @default false
   */
  experimentalFullScreenCanvas?: boolean

  // Dark mode props

  /**
   * Auto-detect dark mode from PayloadCMS admin.
   * When true (default), dark mode CSS is automatically injected when Payload is in dark mode.
   * Set to false to disable automatic dark mode detection.
   * @default true
   */
  autoDetectDarkMode?: boolean

  /**
   * Show the preview dark mode toggle near the viewport switcher.
   * Allows toggling the preview iframe between light/dark modes independently.
   * @default true
   */
  showPreviewDarkModeToggle?: boolean

  /**
   * Initial state for the preview dark mode toggle.
   * Only used when showPreviewDarkModeToggle is true.
   * @default false (light mode)
   */
  initialPreviewDarkMode?: boolean
}

/**
 * Full-featured Puck editor implementation
 *
 * Provides a complete editing experience with:
 * - Save draft and publish functionality
 * - Unsaved changes tracking with beforeunload warning
 * - Interactive/Edit mode toggle
 * - Theme-aware preview backgrounds
 * - Responsive viewport switching
 * - Custom header actions
 *
 * Internal implementation component - use PuckEditor instead.
 * @internal
 */
export function PuckEditorImpl({
  pageId,
  initialData,
  config,
  pageTitle,
  pageSlug,
  apiEndpoint = '/api/puck/pages',
  backUrl,
  previewUrl,
  enableViewports = true,
  plugins,
  layouts,
  layoutStyles,
  layoutKey = 'pageLayout',
  headerActionsStart,
  headerActionsEnd,
  overrides: customOverrides,
  onSaveSuccess,
  onSaveError,
  onChange: onChangeProp,
  initialStatus,
  theme,
  editorStylesheets: editorStylesheetsProp,
  editorCss: editorCssProp,
  enableAi = false,
  aiOptions,
  hasPromptsCollection = false,
  hasContextCollection = false,
  experimentalFullScreenCanvas = false,
  autoDetectDarkMode = true,
  showPreviewDarkModeToggle = true,
  initialPreviewDarkMode = false,
}: PuckEditorImplProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState<'draft' | 'published' | undefined>(initialStatus)
  // Track if document was ever published (initially or during this session)
  const [wasPublished, setWasPublished] = useState(initialStatus === 'published')
  const { hasUnsavedChanges, markClean, markDirty } = useUnsavedChanges()

  // Get current locale code
  const { code: currentLocale } = useLocale();
  // Store the initial locale on mount
  const initialLocale = useRef(currentLocale);
  useEffect(() => {
    // If the locale changes from what it was at load, force a hard refresh
    if (initialLocale.current && currentLocale !== initialLocale.current) {
      window.location.reload();
    }
  }, [currentLocale]);

  // Preview modal state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Preview dark mode state (for toggling dark/light in preview iframe)
  // If not explicitly set, derive from the active layout's editorDarkMode setting
  const initialDarkMode = useMemo(() => {
    if (initialPreviewDarkMode) return true
    if (!layouts || layouts.length === 0) return false
    // Check the initial data's pageLayout to find the active layout
    const pageLayout = (initialData as PuckDataWithMeta)?.root?.props?.[layoutKey] as string | undefined
    const activeLayout = layouts.find(l => l.value === pageLayout) ?? layouts[0]
    return activeLayout?.editorDarkMode ?? false
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only compute once on mount
  const [previewDarkMode, setPreviewDarkMode] = useState(initialDarkMode)

  // Inject slug into initial data if not present
  const dataWithSlug = useMemo<PuckDataWithMeta>(() => {
    const data = initialData as PuckDataWithMeta
    return {
      ...data,
      root: {
        ...data.root,
        props: {
          ...data.root?.props,
          slug: data.root?.props?.slug || pageSlug,
        },
      },
    }
  }, [initialData, pageSlug])

  // Use a ref to track latest data without causing re-renders
  const latestDataRef = useRef<PuckDataWithMeta>(dataWithSlug)

  // Track the last loaded/saved data so we can distinguish real user edits from
  // no-op onChange dispatches (e.g. Puck's mount-time resolve pass). Refreshed at
  // every markClean() site (save / publish) so subsequent edits diff against the
  // most recently persisted state.
  const savedDataRef = useRef<PuckDataWithMeta>(dataWithSlug)

  // Get editor stylesheets from PuckConfigProvider context (as fallback)
  const { editorStylesheets: contextStylesheets, editorCss: contextCss } = usePuckConfig()

  // Props take precedence over context
  const baseStylesheets = editorStylesheetsProp || contextStylesheets
  const baseCss = editorCssProp || contextCss

  // Get current layout to merge layout-specific stylesheets
  const currentLayoutValue = dataWithSlug.root?.props?.pageLayout || 'default'
  const currentLayout = useMemo(() => {
    return layouts?.find((l) => l.value === currentLayoutValue)
  }, [layouts, currentLayoutValue])

  // Merge base stylesheets (props/context) + layout-specific settings
  const mergedEditorStylesheets = useMemo(() => {
    const fromBase = baseStylesheets || []
    const fromLayout = currentLayout?.editorStylesheets || []
    return [...new Set([...fromBase, ...fromLayout])]
  }, [baseStylesheets, currentLayout?.editorStylesheets])

  // Merge base CSS (props/context) + layout-specific settings
  const mergedEditorCss = useMemo(() => {
    const parts = [baseCss, currentLayout?.editorCss].filter(Boolean) as string[]
    return parts.length > 0 ? parts.join('\n') : undefined
  }, [baseCss, currentLayout?.editorCss])

  // Helper to make save request with optional homepage swap
  const makeSaveRequest = useCallback(
    async (
      data: Data,
      options: { publish?: boolean; swapHomepage?: boolean, currentLocale?: string } = {}
    ): Promise<Response> => {
      const typedData = data as PuckDataWithMeta
      return fetch(`${apiEndpoint}/${pageId}${currentLocale ? `?locale=${currentLocale}` : ''}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puckData: data,
          title: typedData.root?.props?.title || pageTitle,
          slug: typedData.root?.props?.slug || pageSlug,
          isHomepage: typedData.root?.props?.isHomepage,
          swapHomepage: options.swapHomepage,
          // Page-tree integration: include folder and pageSegment if present
          folder: typedData.root?.props?.folder,
          pageSegment: typedData.root?.props?.pageSegment,
          ...(options.publish ? { _status: 'published' } : { draft: true }),
        }),
      })
    },
    [apiEndpoint, pageId, pageTitle, pageSlug, currentLocale]
  )

  // Handle homepage conflict - prompt user to swap
  const handleHomepageConflict = useCallback(
    async (
      existingHomepage: { id: string; title: string; slug: string },
      data: Data,
      publish: boolean
    ): Promise<boolean> => {
      const confirmed = confirm(
        `"${existingHomepage.title}" (/${existingHomepage.slug}) is currently set as the homepage.\n\nDo you want to make this page the homepage instead?`
      )
      if (!confirmed) {
        return false
      }

      // Retry with swapHomepage flag
      const response = await makeSaveRequest(data, { publish, swapHomepage: true, currentLocale })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || errorData.message || 'Failed to swap homepage')
      }
      return true
    },
    [makeSaveRequest, currentLocale]
  )

  // Handle save (as draft)
  const handleSave = useCallback(
    async (data: Data) => {
      setIsSaving(true)
      const typedData = data as PuckDataWithMeta
      try {
        const response = await makeSaveRequest(data, { publish: false, currentLocale})

        if (!response.ok) {
          const errorData = await response.json()

          // Check for homepage conflict error
          if (errorData.data?.existingHomepage) {
            const swapped = await handleHomepageConflict(
              errorData.data.existingHomepage,
              data,
              false
            )
            if (!swapped) {
              // User cancelled - don't show error, just return
              setIsSaving(false)
              return
            }
            // Successfully swapped - continue to success handling below
          } else {
            const errorMessage = errorData.error || errorData.message || 'Failed to save page'
            const err = new Error(errorMessage) as Error & { field?: string; details?: unknown }
            err.field = errorData.field
            err.details = errorData.details
            throw err
          }
        }

        setLastSaved(new Date())
        setSaveError(null) // Clear any previous error
        // After saving as draft, update status to draft (shows "Unpublished Changes" if was published)
        setDocumentStatus('draft')
        savedDataRef.current = typedData
        markClean()
        onSaveSuccess?.(data)
      } catch (error) {
        console.error('Error saving page:', error)
        setSaveError(error instanceof Error ? error.message : 'Unknown error')
        onSaveError?.(error instanceof Error ? error : new Error('Unknown error'))
      } finally {
        setIsSaving(false)
      }
    },
    [makeSaveRequest, handleHomepageConflict, markClean, onSaveSuccess, onSaveError, currentLocale]
  )

  // Handle publish
  const handlePublish = useCallback(
    async (data: Data) => {
      setIsSaving(true)
      const typedData = data as PuckDataWithMeta
      try {
        const response = await makeSaveRequest(data, { publish: true })

        if (!response.ok) {
          const errorData = await response.json()

          // Check for homepage conflict error
          if (errorData.data?.existingHomepage) {
            const swapped = await handleHomepageConflict(
              errorData.data.existingHomepage,
              data,
              true
            )
            if (!swapped) {
              // User cancelled - don't show error, just return
              setIsSaving(false)
              return
            }
            // Successfully swapped - continue to success handling below
          } else {
            const errorMessage = errorData.error || errorData.message || 'Failed to publish page'
            const err = new Error(errorMessage) as Error & { field?: string; details?: unknown }
            err.field = errorData.field
            err.details = errorData.details
            throw err
          }
        }

        setLastSaved(new Date())
        setSaveError(null) // Clear any previous error
        setDocumentStatus('published') // Update status after successful publish
        setWasPublished(true) // Mark as having been published
        savedDataRef.current = typedData
        markClean()
        onSaveSuccess?.(data)
      } catch (error) {
        console.error('Error publishing page:', error)
        setSaveError(error instanceof Error ? error.message : 'Unknown error')
        onSaveError?.(error instanceof Error ? error : new Error('Unknown error'))
      } finally {
        setIsSaving(false)
      }
    },
    [makeSaveRequest, handleHomepageConflict, markClean, onSaveSuccess, onSaveError]
  )

  // Handle unpublish (revert to draft)
  const handleUnpublish = useCallback(
    async () => {
      if (!confirm('This will unpublish the page and return it to draft status. Continue?')) {
        return
      }

      setIsSaving(true)
      try {
        const response = await fetch(`${apiEndpoint}/${pageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            _status: 'draft',
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          const errorMessage = errorData.error || errorData.message || 'Failed to unpublish page'
          throw new Error(errorMessage)
        }

        setLastSaved(new Date())
        setSaveError(null)
        setDocumentStatus('draft')
      } catch (error) {
        console.error('Error unpublishing page:', error)
        setSaveError(error instanceof Error ? error.message : 'Unknown error')
      } finally {
        setIsSaving(false)
      }
    },
    [apiEndpoint, pageId]
  )

  // Handle data change
  const handleChange = useCallback(
    (data: Data) => {
      latestDataRef.current = data as PuckDataWithMeta
      // Only mark dirty when the data actually differs from the last loaded/saved
      // state. Puck fires onChange for no-op mount-time resolves (which can differ
      // from the loaded data only by undefined-valued keys); treating those as
      // edits produces a spurious "Unsaved" flag on load. isDataEqual is
      // undefined-tolerant so those resolves compare equal and clear the flag.
      if (isDataEqual(data, savedDataRef.current)) {
        markClean()
      } else {
        markDirty()
      }
      onChangeProp?.(data)
    },
    [markClean, markDirty, onChangeProp]
  )

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to leave?')) {
        return
      }
    }
    if (backUrl) {
      router.push(backUrl)
    } else {
      router.back()
    }
  }, [hasUnsavedChanges, router, backUrl])

  // Handle preview (opens in new tab)
  const handlePreview = useCallback(() => {
    const rootProps = latestDataRef.current?.root?.props
    const currentSlug = rootProps?.slug || pageSlug
    const isHomepage = rootProps?.isHomepage === true
    let url: string
    if (typeof previewUrl === 'function') {
      // If homepage, pass '/' to the function, otherwise pass the slug
      url = previewUrl(isHomepage ? '' : currentSlug)
    } else if (previewUrl) {
      url = previewUrl
    } else {
      // If homepage, navigate to root, otherwise use slug
      url = isHomepage ? '/' : `/${currentSlug}`
    }
    window.open(url, '_blank')
  }, [pageSlug, previewUrl])

  // Handle opening preview modal
  const handleOpenPreview = useCallback(() => {
    setIsPreviewOpen(true)
  }, [])

  // Handle save from preview modal (returns Promise for navigation flow)
  const handleSaveFromPreview = useCallback(async () => {
    const data = latestDataRef.current
    setIsSaving(true)
    try {
      const response = await fetch(`${apiEndpoint}/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puckData: data,
          title: data?.root?.props?.title || pageTitle,
          slug: data?.root?.props?.slug || pageSlug,
          // Page-tree integration: include folder and pageSegment if present
          folder: data?.root?.props?.folder,
          pageSegment: data?.root?.props?.pageSegment,
          draft: true,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.error || errorData.message || 'Failed to save page'
        throw new Error(errorMessage)
      }

      setLastSaved(new Date())
      setSaveError(null)
      setDocumentStatus('draft')
      markClean()
      onSaveSuccess?.(data)
    } catch (error) {
      console.error('Error saving page:', error)
      setSaveError(error instanceof Error ? error.message : 'Unknown error')
      onSaveError?.(error instanceof Error ? error : new Error('Unknown error'))
      throw error // Re-throw so preview modal knows save failed
    } finally {
      setIsSaving(false)
    }
  }, [apiEndpoint, pageId, pageTitle, pageSlug, markClean, onSaveSuccess, onSaveError])

  // Memoized overrides
  const overrides = useMemo<Partial<PuckOverrides>>(
    () => ({
      headerActions: ({ children }: { children: ReactNode }) => (
        <HeaderActions
          onBack={handleBack}
          onPreview={handlePreview}
          onSave={handleSave}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
          onOpenPreview={handleOpenPreview}
          isSaving={isSaving}
          hasUnsavedChanges={hasUnsavedChanges}
          lastSaved={lastSaved}
          documentStatus={documentStatus}
          wasPublished={wasPublished}
          actionsStart={headerActionsStart}
          actionsEnd={headerActionsEnd}
          pageId={pageId}
          apiEndpoint={apiEndpoint}
          saveError={saveError}
          onDismissError={() => setSaveError(null)}
          showVersionHistory={false}
          showPreviewDarkModeToggle={showPreviewDarkModeToggle}
          previewDarkMode={previewDarkMode}
          onPreviewDarkModeChange={setPreviewDarkMode}
        >
          {children}
        </HeaderActions>
      ),
      // Always wrap iframe for richtext styles injection and theme-aware background
      iframe: ({ children, document }: { children: ReactNode; document?: Document }) => (
        <IframeWrapper
          document={document}
          layouts={layouts}
          layoutStyles={layoutStyles}
          layoutKey={layoutKey}
          editorStylesheets={mergedEditorStylesheets}
          editorCss={mergedEditorCss}
          previewDarkModeOverride={showPreviewDarkModeToggle ? previewDarkMode : undefined}
        >
          {children}
        </IframeWrapper>
      ),
      // Merge custom overrides
      ...customOverrides,
    }),
    [
      handleBack,
      handlePreview,
      handleSave,
      handlePublish,
      handleUnpublish,
      handleOpenPreview,
      isSaving,
      hasUnsavedChanges,
      lastSaved,
      saveError,
      documentStatus,
      wasPublished,
      headerActionsStart,
      headerActionsEnd,
      pageId,
      apiEndpoint,
      layouts,
      layoutStyles,
      layoutKey,
      customOverrides,
      mergedEditorStylesheets,
      mergedEditorCss,
      showPreviewDarkModeToggle,
      previewDarkMode,
      setPreviewDarkMode,
    ]
  )

  // Default plugins - headingAnalyzer is always included unless plugins is explicitly false
  const defaultPlugins: PuckPlugin[] = [headingAnalyzer]

  // Version history plugin for the plugin rail
  const versionHistoryPlugin = useMemo(() => {
    if (!pageId) return null
    return createVersionHistoryPlugin({
      pageId,
      apiEndpoint,
      onRestoreSuccess: markClean,
    })
  }, [pageId, apiEndpoint, markClean])

  // Fetch AI prompts client-side when prompts collection is enabled
  // This allows prompts to update in real-time when edited via the prompt editor panel
  const { prompts: clientPrompts, loading: promptsLoading } = useAiPrompts(
    '/api/puck/ai-prompts',
    enableAi && hasPromptsCollection
  )

  // Use refs to store the latest prompts so onClick handlers can access current values
  // without causing the plugin to be recreated (which would cause Puck to remount panels)
  const clientPromptsRef = useRef(clientPrompts)
  clientPromptsRef.current = clientPrompts
  const staticPromptsRef = useRef(aiOptions?.examplePrompts)
  staticPromptsRef.current = aiOptions?.examplePrompts

  // AI plugin - statically imported, only instantiated when enabled
  // IMPORTANT: We intentionally exclude clientPrompts and aiOptions.examplePrompts from deps
  // to prevent plugin recreation. The onClick handlers use refs to access current prompts.
  const aiPlugin = useMemo(() => {
    if (!enableAi) return null
    // Don't create plugin until prompts are loaded (when using prompts collection)
    if (hasPromptsCollection && promptsLoading) return null

    // Use client-fetched prompts when prompts collection is enabled,
    // otherwise fall back to static props from config
    // NOTE: We read from refs in onClick to get current values without causing re-renders
    const getPrompts = () => hasPromptsCollection
      ? (clientPromptsRef.current || [])
      : (staticPromptsRef.current || [])

    // Get initial prompts for labels (labels are stable, only prompts text might change)
    const initialPrompts = getPrompts()

    // Convert our { label, prompt } format to plugin's { label, onClick } format
    // The plugin expects onClick to send the message via window.__PUCK_AI.sendMessage
    const convertedPrompts = initialPrompts.map((item, index) => ({
      label: item.label,
      onClick: () => {
        // Access current prompts via ref to get latest values
        const currentPrompts = getPrompts()
        const currentPrompt = currentPrompts[index]?.prompt || item.prompt
        // Use Puck AI's global API to send the prompt as a user message
        // sendMessage accepts { text: string } as a simpler format
        if (typeof window !== 'undefined' && (window as any).__PUCK_AI?.sendMessage) {
          ;(window as any).__PUCK_AI.sendMessage({ text: currentPrompt })
        }
      },
    }))

    return createAiPlugin({
      host: aiOptions?.host || '/api/puck/ai',
      chat: {
        examplePrompts: convertedPrompts.length > 0 ? convertedPrompts : undefined,
      },
      prepareRequest: aiOptions?.prepareRequest,
      scrollTracking: aiOptions?.scrollTracking,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally omit prompt arrays to prevent recreation
  }, [enableAi, hasPromptsCollection, promptsLoading, aiOptions?.host])

  // Prompt editor plugin - for managing AI prompts in the plugin rail
  const promptEditorPlugin = useMemo(() => {
    if (!enableAi || !hasPromptsCollection) return null

    try {
      // Dynamic require to avoid errors if module not available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createPromptEditorPlugin } = require('../ai/plugins/promptEditorPlugin')
      return createPromptEditorPlugin({
        apiEndpoint: '/api/puck/ai-prompts',
      })
    } catch (e) {
      console.warn('[PuckEditor] Failed to load prompt editor plugin:', e)
      return null
    }
  }, [enableAi, hasPromptsCollection])

  // Context editor plugin - for managing AI context in the plugin rail
  const contextEditorPlugin = useMemo(() => {
    if (!enableAi || !hasContextCollection) return null

    try {
      // Dynamic require to avoid errors if module not available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createContextEditorPlugin } = require('../ai/plugins/contextEditorPlugin')
      return createContextEditorPlugin({
        apiEndpoint: '/api/puck/ai-context',
      })
    } catch (e) {
      console.warn('[PuckEditor] Failed to load context editor plugin:', e)
      return null
    }
  }, [enableAi, hasContextCollection])

  const resolvedPlugins = useMemo(() => {
    if (plugins === false) return undefined
    const base = !plugins || plugins.length === 0 ? defaultPlugins : [...defaultPlugins, ...plugins]

    // Add version history plugin if available
    if (versionHistoryPlugin) {
      base.push(versionHistoryPlugin)
    }

    // Add AI plugin if enabled
    if (aiPlugin) {
      base.push(aiPlugin)
    }

    // Add prompt editor plugin if enabled
    if (promptEditorPlugin) {
      base.push(promptEditorPlugin)
    }

    // Add context editor plugin if enabled
    if (contextEditorPlugin) {
      base.push(contextEditorPlugin)
    }

    return base
  }, [plugins, versionHistoryPlugin, aiPlugin, promptEditorPlugin, contextEditorPlugin])

  const editorContent = (
    <>
      {/* Dark mode CSS injection - automatically detects PayloadCMS dark mode */}
      {autoDetectDarkMode && <DarkModeStyles />}
      <div className="h-screen">
        <Puck
          config={config}
          data={dataWithSlug}
          onChange={handleChange}
          onPublish={handlePublish}
          headerTitle={`${pageTitle} /${pageSlug}`}
          plugins={resolvedPlugins}
          viewports={enableViewports ? DEFAULT_VIEWPORTS : undefined}
          overrides={overrides}
          iframe={{ waitForStyles: true }}
          _experimentalFullScreenCanvas={experimentalFullScreenCanvas}
        />
      </div>
      <PreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        data={latestDataRef.current}
        pageTitle={pageTitle}
        onOpenInNewTab={handlePreview}
        layouts={layouts}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={handleSaveFromPreview}
        isSaving={isSaving}
        editorStylesheets={mergedEditorStylesheets}
        editorCss={mergedEditorCss}
        config={config}
      />
    </>
  )

  // Wrap with ThemeProvider if theme is provided
  if (theme) {
    return <ThemeProvider theme={theme}>{editorContent}</ThemeProvider>
  }

  return editorContent
}
