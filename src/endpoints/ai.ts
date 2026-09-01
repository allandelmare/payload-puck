import type { PayloadHandler, PayloadRequest } from 'payload'
import type { AiTool, AiToolContext, AiContext } from '../ai/types.js'
import { pagePatternSystemContext } from '../ai/presets/index.js'

// Re-export for convenience
export type { AiTool, AiToolContext }

/**
 * Collection slug for AI context
 * Matches the auto-generated collection from createPuckPlugin
 */
const AI_CONTEXT_COLLECTION = 'puck-ai-context'

/**
 * Fetches dynamic context entries from the database
 * @param req - The Payload request object
 * @returns Concatenated context string or undefined if no entries
 */
async function fetchDynamicContext(req: PayloadRequest): Promise<string | undefined> {
  try {
    // Check if the context collection exists (it's optional)
    const collections = req.payload.config.collections
    const hasContextCollection = collections?.some((c) => c.slug === AI_CONTEXT_COLLECTION)

    if (!hasContextCollection) {
      return undefined
    }

    // Fetch enabled context entries, sorted by order.
    //
    // `overrideAccess: true` is deliberate here, and is the one sink in the
    // request path that keeps it. This is a trusted server-side read that builds
    // the AI system prompt; it is never returned to the caller as data. The
    // prompt must be identical for every operator allowed to invoke generation,
    // otherwise output would silently vary with each user's read permissions on
    // the context collection. Authorization for *using* AI generation is enforced
    // by the endpoint's own `req.user` gate, above this call.
    //
    // Contrast with endpoints/context.ts, where the same collection is exposed
    // as user-facing CRUD and is access-controlled (GHSA-rrx7-m589-5wfq).
    const result = await req.payload.find({
      collection: AI_CONTEXT_COLLECTION,
      overrideAccess: true,
      where: { enabled: { equals: true } },
      sort: 'order',
      limit: 100, // Reasonable limit for context entries
    })

    if (!result.docs || result.docs.length === 0) {
      return undefined
    }

    // Format each context entry with its name as a header
    const contextBlocks = (result.docs as AiContext[]).map((doc) => {
      const header = doc.category ? `## ${doc.name} (${doc.category})` : `## ${doc.name}`
      return `${header}\n\n${doc.content}`
    })

    return contextBlocks.join('\n\n---\n\n')
  } catch (e) {
    // Log but don't fail - context is optional
    console.warn('[payload-puck] Failed to fetch dynamic AI context:', e)
    return undefined
  }
}

/**
 * Options for the AI endpoint handler
 */
export interface AiEndpointOptions {
  /**
   * Business context for AI generation
   * Helps the AI understand your brand, tone, and requirements
   */
  context?: string
  /**
   * Custom tools for AI to use during generation
   * These allow AI to perform actions like database lookups, API calls, etc.
   */
  tools?: Record<string, AiTool>
  /**
   * Callback invoked when AI generation finishes with usage metrics.
   */
  onFinish?: (result: {
    totalCost: number
    tokenUsage: {
      inputTokens: number | undefined
      outputTokens: number | undefined
      totalTokens: number | undefined
      reasoningTokens?: number | undefined
      cachedInputTokens?: number | undefined
    }
  }) => void
}

/**
 * Creates a Payload endpoint handler for Puck AI
 *
 * This handler wraps @puckeditor/cloud-client's puckHandler with
 * Payload authentication. It's auto-registered by createPuckPlugin
 * when `ai.enabled: true`.
 *
 * @example
 * // Automatically registered at /api/puck/ai when:
 * createPuckPlugin({
 *   ai: {
 *     enabled: true,
 *     context: 'You build pages for Acme Corp...',
 *   },
 * })
 */
export function createAiEndpointHandler(options: AiEndpointOptions = {}): PayloadHandler {
  return async (req) => {
    // 1. Require authentication - AI features are admin-only
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Lazy import to avoid bundle bloat (like PostCSS pattern in styles.ts)
    let puckHandler: typeof import('@puckeditor/cloud-client').puckHandler
    try {
      const cloudClient = await import('@puckeditor/cloud-client')
      puckHandler = cloudClient.puckHandler
    } catch (e) {
      console.error('[payload-puck] Failed to load @puckeditor/cloud-client:', e)
      return Response.json(
        { error: 'AI requires @puckeditor/cloud-client. This should be bundled with the plugin.' },
        { status: 500 }
      )
    }

    // 3. Check for API key
    const apiKey = process.env.PUCK_API_KEY
    if (!apiKey) {
      return Response.json(
        { error: 'PUCK_API_KEY environment variable is not set' },
        { status: 500 }
      )
    }

    // 4. Forward to Puck Cloud handler
    // puckHandler expects a standard Web Request object with specific pathname
    // The handler internally routes based on pathname - it expects /api/puck/chat
    // See: @puckeditor/cloud-client/src/routes.ts - routeRegistry['/api/puck/chat']
    try {
      // Get the request body
      const body = await req.json?.()

      // NOTE: We previously removed null values from defaultProps here, but this
      // was preventing the AI from knowing about optional styling fields.
      // Per Puck docs: "All fields in defaultProps are considered required by the agent"
      // Fields with null values still need to be present so the AI knows they exist.

      // Auto-exclude custom fields in root that don't have ai.exclude set
      // BUT: if field has AI instructions, don't exclude it (we want AI to use it)
      // This handles fields added by page-tree or user customization
      if (body?.config?.root?.fields) {
        for (const [fieldName, field] of Object.entries(body.config.root.fields)) {
          const f = field as any
          // Only exclude if: is custom, doesn't have exclude set, AND doesn't have instructions
          if (f.type === 'custom' && !f.ai?.exclude && !f.ai?.instructions) {
            f.ai = { ...f.ai, exclude: true }
          }
        }
      }

      // Auto-exclude custom fields in components that don't have ai.exclude set
      // BUT: if field has AI instructions, don't exclude it (we want AI to use it)
      if (body?.config?.components) {
        for (const [, comp] of Object.entries(body.config.components)) {
          const c = comp as any
          if (c.fields) {
            for (const [, field] of Object.entries(c.fields)) {
              const f = field as any
              // Only exclude if: is custom, doesn't have exclude set, AND doesn't have instructions
              if (f.type === 'custom' && !f.ai?.exclude && !f.ai?.instructions) {
                f.ai = { ...f.ai, exclude: true }
              }
            }
          }
        }
      }

      // Validate required fields - puckHandler expects config and pageData
      if (!body) {
        return Response.json({ error: 'Request body is required' }, { status: 400 })
      }

      // Ensure config exists (puckHandler needs this)
      if (!body.config) {
        console.warn('[payload-puck] AI request missing config, this may cause issues')
      }

      // Construct URL with the pathname puckHandler expects
      // Our Payload endpoint is /api/puck/ai but puckHandler routes to /api/puck/chat
      const protocol = req.headers.get('x-forwarded-proto') || 'http'
      const host = req.headers.get('host') || 'localhost'
      const url = `${protocol}://${host}/api/puck/chat`

      // Create new headers without content-length (will be recalculated)
      const headers = new Headers()
      headers.set('content-type', 'application/json')
      // Copy auth headers
      const authHeader = req.headers.get('authorization')
      if (authHeader) {
        headers.set('authorization', authHeader)
      }

      const webRequest = new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      // Build AI options, only including properties that have values
      // (passing `tools: undefined` explicitly prevents the default from applying)
      const aiOptions: { context?: string; tools?: Record<string, any> } = {}

      // Build context from multiple sources:
      // 1. Static context from plugin config
      // 2. Dynamic context from database (puck-ai-context collection)
      // 3. Page pattern system context (composition guidance)
      const contextParts: string[] = []

      // Add static context from plugin config
      if (options.context) {
        contextParts.push(options.context)
      }

      // Fetch and add dynamic context from database
      const dynamicContext = await fetchDynamicContext(req)
      if (dynamicContext) {
        contextParts.push('# Business Context\n\n' + dynamicContext)
      }

      // Always add page pattern system context for better composition
      if (pagePatternSystemContext) {
        contextParts.push(pagePatternSystemContext)
      }

      // Combine all context parts
      if (contextParts.length > 0) {
        aiOptions.context = contextParts.join('\n\n---\n\n')
      }

      // Wrap tools to inject Payload context into execute functions
      if (options.tools && Object.keys(options.tools).length > 0) {
        const toolContext: AiToolContext = {
          payload: req.payload,
          // Tools read on behalf of the operator, so they must be evaluated
          // against that user's access rules — otherwise a low-privilege editor
          // can have the model read documents they cannot, and echo the content
          // back through generated output.
          user: req.user,
        }

        // Create wrapped tools that inject the context
        const wrappedTools: Record<string, any> = {}
        for (const [name, tool] of Object.entries(options.tools)) {
          wrappedTools[name] = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            mode: tool.mode,
            // Wrap execute to inject Payload context
            execute: (input: any) => tool.execute(input, toolContext),
          }
        }
        aiOptions.tools = wrappedTools
      }

      const response = await puckHandler(webRequest, {
        ai: {
          ...aiOptions,
          onFinish: options.onFinish,
        },
        apiKey,
      })

      if (!response.ok) {
        // Try to get more info from error response
        const clonedResponse = response.clone()
        try {
          const errorBody = await clonedResponse.json()
          console.error('[payload-puck] Puck Cloud error body:', errorBody)
        } catch {
          const errorText = await clonedResponse.text()
          console.error('[payload-puck] Puck Cloud error text:', errorText)
        }
      }

      return response
    } catch (e) {
      console.error('[payload-puck] AI handler error:', e)
      return Response.json(
        { error: e instanceof Error ? e.message : 'AI request failed' },
        { status: 500 }
      )
    }
  }
}
