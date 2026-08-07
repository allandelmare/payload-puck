import { describe, expect, it, vi } from 'vitest'
import { createPuckPlugin } from '../../src/plugin/index.js'

/**
 * The editor stylesheet contract, pinned.
 *
 * The previous design resolved a *different* URL per environment (a runtime
 * compile endpoint in development, a build-time file in production). That split
 * is exactly how the editor came to look correct locally and render unstyled in
 * production for a month without anyone noticing. These tests exist to keep the
 * resolution environment-independent.
 */
function buildConfig(pluginOptions: Parameters<typeof createPuckPlugin>[0]) {
  const plugin = createPuckPlugin(pluginOptions)
  // Minimal Payload config shape — enough for the plugin to decorate.
  return plugin({ collections: [], custom: {} } as never) as {
    custom?: { puck?: { editorStylesheets?: string[] } }
    endpoints?: Array<{ path: string }>
  }
}

describe('createPuckPlugin — editor stylesheets', () => {
  it('publishes the configured URLs on config.custom.puck for the editor to read', () => {
    const config = buildConfig({
      pagesCollection: 'pages',
      editorStylesheets: ['/puck-editor-styles.css'],
    })
    expect(config.custom?.puck?.editorStylesheets).toEqual(['/puck-editor-styles.css'])
  })

  it('preserves order, so later sheets can override earlier ones', () => {
    const config = buildConfig({
      pagesCollection: 'pages',
      editorStylesheets: ['/base.css', '/theme.css', 'https://fonts.example/f.css'],
    })
    expect(config.custom?.puck?.editorStylesheets).toEqual([
      '/base.css',
      '/theme.css',
      'https://fonts.example/f.css',
    ])
  })

  it('resolves identically in development and production', () => {
    const seen = new Set<string>()
    for (const env of ['development', 'production', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      const config = buildConfig({
        pagesCollection: 'pages',
        editorStylesheets: ['/puck-editor-styles.css'],
      })
      seen.add(JSON.stringify(config.custom?.puck?.editorStylesheets))
    }
    vi.unstubAllEnvs()
    // One distinct resolution across every environment — no dev/prod split.
    expect(seen.size).toBe(1)
  })

  it('never registers a runtime CSS-compilation endpoint', () => {
    const config = buildConfig({
      pagesCollection: 'pages',
      editorStylesheets: ['/puck-editor-styles.css'],
    })
    const paths = (config.endpoints ?? []).map((e) => e.path)
    expect(paths).not.toContain('/puck/styles')
  })

  it('omits the key entirely when nothing is configured, rather than inventing a URL', () => {
    const config = buildConfig({ pagesCollection: 'pages' })
    expect(config.custom?.puck?.editorStylesheets).toBeUndefined()
  })
})
