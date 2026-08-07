# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.2] - 2026-08-07

### Changed

- **Breaking-change notices now sit at the top of the README**, immediately after the badges rather than buried under `Install > Requirements`, matching the convention used across the sibling plugins. `0.7.0` and `0.8.0` were both breaking and shipped hours apart, so anyone upgrading from `0.6.x` needs both migrations — and the 0.8 one is easy to miss precisely because the symptom (an unstyled editor) only appears in production. Docs-only.

## [0.8.1] - 2026-08-07

### Fixed

- **Corrected the 0.8.0 upgrade instructions**, which did not work as written. Two problems, both found by running them against a real project: Tailwind **v4 ships its CLI as a separate package**, so `pnpm add -D @tailwindcss/cli` is required before the `tailwindcss` binary exists (v3 bundles it); and the example paths were unquoted, so an App Router route group like `src/app/(frontend)/globals.css` aborted with a shell syntax error on the parentheses. Docs-only — no code change.

## [0.8.0] - 2026-08-07

### Breaking

- **Editor CSS is no longer compiled by this plugin. You now build it with Tailwind's own CLI and hand the plugin a URL.** The three stylesheet options (`editorStylesheet`, `editorStylesheetCompiled`, `editorStylesheetUrls`) collapse into one: **`editorStylesheets: string[]`**, a plain ordered list of URLs the editor iframe loads. Removed alongside them: the `/api/puck/styles` runtime-compilation endpoint, the `@delmaredigital/payload-puck/next` entry point and its `withPuckCSS()` wrapper, and the `postcss` / `postcss-load-config` peer dependencies (nothing in the plugin imports them any more).

  **To upgrade**, generate the stylesheet in your build and pass its URL:

  Tailwind v4 ships its CLI separately, so install it first: `pnpm add -D @tailwindcss/cli` (v3 users already have the `tailwindcss` binary).

  ```jsonc
  // package.json — quote the paths; App Router route groups like (frontend) are shell syntax
  "scripts": {
    "build:puck-css": "tailwindcss -i './src/app/(frontend)/globals.css' -o './public/puck-editor-styles.css'",
    "dev:puck-css": "tailwindcss -i './src/app/(frontend)/globals.css' -o './public/puck-editor-styles.css' --watch",
    "build": "pnpm build:puck-css && next build",
    "dev": "pnpm build:puck-css && next dev"
  }
  ```

  Add `public/puck-editor-styles.css` to `.gitignore` — it is a build artifact. Run `dev:puck-css` in a second terminal when you are actively editing theme CSS.

  ```typescript
  // payload.config.ts — before
  createPuckPlugin({
    editorStylesheet: 'src/app/(frontend)/globals.css',
    editorStylesheetCompiled: '/puck-editor-styles.css',
    editorStylesheetUrls: ['https://fonts.googleapis.com/css2?family=Inter'],
  })

  // after
  createPuckPlugin({
    editorStylesheets: ['/puck-editor-styles.css', 'https://fonts.googleapis.com/css2?family=Inter'],
  })
  ```

  Then delete the `withPuckCSS` import and wrapper from `next.config.js`, and drop any `editorStylesheets` prop you were passing to `PuckConfigProvider` — the plugin publishes the resolved list on `config.custom.puck.editorStylesheets` and `PuckEditorView` passes it to the editor for you. (The prop still works as an escape hatch for custom editor routes.)

  **Why:** the old design resolved a *different* URL per environment — a runtime PostCSS/Tailwind compile in development, a build-time file in production — and the production half was produced by a **webpack plugin**. Next.js 16 defaults to Turbopack, which never calls the `webpack()` config hook, so on any Next 16 project the production stylesheet was silently never generated and the editor rendered completely unstyled — while local development, served by the runtime endpoint, looked perfect. Compiling at runtime was also wrong on its own terms: it put a full Tailwind build on the request path and required build tooling as production dependencies. Your app's own toolchain already compiles this CSS correctly; the plugin now consumes that artifact instead of reimplementing it, and the same URL resolves in every environment.

### Fixed

- **The editor preview rendered unstyled in production on any Next.js 16 project.** Root cause above: `withPuckCSS` was webpack-only and Next 16 defaults to Turbopack, so `public/puck-editor-styles.css` was never written and the iframe's stylesheet request 404'd. Now that the file is produced by an ordinary build script, it cannot depend on which bundler Next chose.

### Removed

- `@delmaredigital/payload-puck/next` entry point (`withPuckCSS`, `getPuckCSSPath`, `PUCK_CSS_OUTPUT_DEFAULT`).
- `/api/puck/styles` endpoint and the `PUCK_STYLES_ENDPOINT` constant.
- `postcss` and `postcss-load-config` peer dependencies.

### Added

- Tests pinning the stylesheet contract, including one asserting the resolved URLs are **identical across `development`, `production`, and `test`** — the environment-dependent resolution is what made the outage invisible locally, so it is now a test failure rather than a deploy-time surprise.

## [0.7.0] - 2026-08-07

### Breaking

- **`@puckeditor/core` peer dependency floor raised from `>=0.21.0` to `>=0.23.0`.** The plugins this package bundles (`@puckeditor/plugin-heading-analyzer`, `@puckeditor/plugin-ai`) are versioned in lockstep with Puck core and import it from the host, so shipping the 0.23 line of those plugins against an older core is not a supported combination. **To upgrade:** `pnpm add @puckeditor/core@^0.23.0`. Note that Puck 0.23 ships a rewritten canvas drag-and-drop engine and a redesigned outline — the editing experience changes visibly even though no API you call has changed. See the [Puck 0.23 release notes](https://puckeditor.com/blog/puck-023).
- **Minimum Node version raised from `^18.20.2 || >=20.9.0` to `>=20.9.0`.** Node 18 reached end-of-life and Puck core 0.23 itself declares `>=20.0.0`, so the old floor was a claim nothing verified. CI now runs the full matrix on Node 20 and 24, making the `engines` field an enforced guarantee rather than an aspiration.

### Fixed

- **The editor no longer flags a document as "Unsaved" on load without any user edit (production builds).** `handleChange` called `markDirty()` unconditionally on every `onChange`, but Puck's mount-time resolve pass dispatches a no-op change whose only difference from the loaded data is `undefined`-valued keys — which strict deep-equality treats as a real change. Incoming data is now diffed against the last loaded/saved state using a new undefined-tolerant comparison (`{}` ≡ `{ k: undefined }`), so a no-op resolve clears the flag instead of setting it while genuine edits still mark the document dirty. Thanks [@georgisoft2020](https://github.com/georgisoft2020). ([#12](https://github.com/delmaredigital/payload-puck/pull/12))
- **Saving from the preview modal left a stale "last saved" baseline.** `handleSaveFromPreview` marked the document clean but never recorded what it had just saved, so the next no-op `onChange` diffed against the pre-save state and re-flagged the document as dirty — reintroducing the bug above immediately after a successful save.
- **Restoring a version left the document flagged as dirty despite having just been persisted.** The restore dispatches `setData` into the editor, and the resulting `onChange` fired *after* `markClean()`, flipping the flag straight back. `onRestoreSuccess` now receives the restored data and adopts it as the new saved baseline. (`createVersionHistoryPlugin`'s `onRestoreSuccess` callback gained an optional `restoredData` argument — additive, so existing zero-argument callbacks continue to work unchanged.)

### Changed

- **Bundled Puck plugins updated:** `@puckeditor/plugin-ai` and `@puckeditor/cloud-client` `^0.7.0` → `^0.8.2`, `@puckeditor/plugin-heading-analyzer` `^0.21.2` → `^0.23.0`. The AI bump also resolves a latent peer conflict: `plugin-ai@0.7` pinned `@puckeditor/core` to `^0.21.0`, which warned for anyone already running core 0.22 or newer. `0.8.x` widens that to `^0`. No API surface used by this package changed.

### Added

- **Continuous integration.** `.github/workflows/ci.yml` runs typecheck, tests, and build on every pull request and every push to `main`, across Node 20 and 24. `publish.yml` now calls the same workflow as a hard gate, so a version tag cannot publish to npm unless those checks pass on the exact commit the tag points at — previously a tag published unconditionally.
- **A test suite.** `vitest` with 46 tests covering the new unsaved-changes comparison, the field-value → CSS converters (including the email-safe variants), and the `editorVersion` content-detection hook. `pnpm test`, `pnpm test:watch`, `pnpm test:coverage`.
- **Grouped Dependabot configuration** (`.github/dependabot.yml`) for npm and GitHub Actions, so routine dependency refreshes arrive as a few reviewable PRs instead of many near-identical ones.

### Changed (internal)

- **GitHub Releases now lead with the hand-written CHANGELOG entry for the version being released**, followed by GitHub's auto-generated commit/contributor summary, instead of the generated summary alone.
- `pnpm typecheck` now covers `tests/` as well as `src/`, via a separate `tsconfig.test.json` (the root `tsconfig.json` remains the build config, rooted at `src/`, so tests can never leak into `dist/`).
- **`typecheck` and `test` no longer fail on a fresh clone.** `src/version.ts` is generated (and git-ignored), but generation was attached only to `prebuild` — so any command that compiles `src/` without building first failed with `Cannot find module '../../version.js'`. It went unnoticed because a previous local build always left the file behind. Generation is now chained explicitly into `build`, `typecheck`, and the `test` scripts rather than relying on pnpm's pre/post script hooks. Caught by the new CI on its first run.

## [0.6.30] - 2026-07-03

### Changed

- **The editor's `/api/puck/styles` dev-time compile endpoint now uses conditional HTTP caching (`ETag`/`Last-Modified`, `Cache-Control: no-cache`) instead of `immutable, max-age=31536000`.** The previous header told browsers to cache the compiled CSS forever on a URL with no versioning, so browsers never learned when the underlying source CSS or the plugin's own compilation logic changed. Revalidation is now cheap (a `304` when unchanged) but always happens.
- **`IframeWrapper`'s editor stylesheet/CSS handling was simplified internally.** The consumer's stylesheets/CSS still render directly inside the Puck preview iframe only (never the host admin page — this was investigated and deliberately rejected; see below), but now as ordinary React children instead of manual `document.createElement`/`appendChild` calls, letting normal React reconciliation add/remove/update them instead of hand-rolled DOM bookkeeping. FOUC prevention is a small `onLoad`/`onError`-driven gate with a timeout safety net (in case a load event never fires for an already-cached resource), replacing the previous forced-reflow/remount-key machinery. No change to public props or behavior.

### Investigated and rejected

- **Rendering the compiled stylesheet on the host admin document so Puck's native `syncHostStyles` could mirror it into the iframe.** This was implemented, then reverted after live testing found it leaked the consumer's Tailwind preflight/reset rules into Payload's own admin UI (confirmed: it broke the admin nav sidebar's styling). A CSS `@layer` fix didn't work (Payload's own admin CSS is also Tailwind-based and also uses layers). A selector-scoping fix (a new `postcss-prefix-selector` dependency, marking the iframe's own `<html>` and rewriting selectors) closed that specific leak but only handled exact `html`/`:root`/`body` selectors — an independent review found it would silently fail to scope realistic compound selectors (e.g. `.dark .foo`, `html.dark {}`, `:root[data-theme='dark']`), a worse fragility class than what it replaced. Reverted in favor of keeping the stylesheet iframe-local, which has zero host-leak risk by construction. This also means the `@puckeditor/core` peer dependency did not need to move past its existing `>=0.21.0` floor — the only mechanism actually used (`waitForStyles`) predates the 0.22 release this investigation started from, so no peer bump was needed after all.

## [0.6.29] - 2026-06-03

### Fixed

- **`Grid`/`Columns` still stacked at all widths (incomplete `0.6.28` fix).** `0.6.28` set the mobile base `grid-template-columns: 1fr` as an **inline style**, which outranks the `@media (min-width: 768px)` rule in the scoped `<style>` block — inline styles beat stylesheet rules, media queries included — so the layout was pinned to a single column at every width (and this also regressed projects where the Tailwind-based layout previously worked). Both the mobile base and the responsive multi-column rule now live in the scoped `<style>` block, so the media query applies correctly. Verified in-browser: single column below 768px, multi-column (with the configured ratios) at and above 768px. ([#10](https://github.com/delmaredigital/payload-puck/issues/10))

## [0.6.28] - 2026-06-03

### Fixed

- **`Grid` and `Columns` now lay out correctly without requiring the consumer's Tailwind to generate the plugin's utility classes.** Both components previously relied on Tailwind classes (`flex flex-col w-full md:grid`) for their `display: grid` / responsive behavior, while only the dynamic `grid-template-columns` came from an inline `<style>`. In projects whose Tailwind build doesn't scan the plugin's `dist` (so those utilities, especially the `md:` variant, are never emitted), the container stayed a plain block and children stacked vertically at all widths. The grid is now fully self-contained: `display: grid` is applied inline (single column on mobile, multi-column at ≥768px via a scoped media query), with no dependency on consumer Tailwind classes. ([#10](https://github.com/delmaredigital/payload-puck/issues/10))

## [0.6.27] - 2026-06-03

### Added

- **`Columns` layout component with independent per-column drop zones.** Unlike `Grid` (a single CSS-grid slot where dropped components auto-place into cells and share one drop zone), `Columns` exposes a separate slot per column, so components can be targeted into a specific column. Supports 2–4 columns and width-distribution presets (equal, or `fr` ratios like `2:1`, `1:2`, `1:1:2`), stacks vertically on mobile, and switches to a CSS grid at ≥768px. Reuses the shared field set (background, padding, margin, border, gap, visibility, animation) for parity with `Grid`. ([#10](https://github.com/delmaredigital/payload-puck/issues/10))

## [0.6.26] - 2026-06-03

### Fixed

- **Plugin endpoints now sync Puck `root.props` back to Payload fields on save.** The plugin's own CRUD endpoints (`/api/puck/:collection/*`) persisted root-only fields (`meta.*`, `pageLayout`, `conversionTracking.*`, etc.) inside the `puckData` blob but never wrote them to their Payload columns — only the standalone `createPuckApiRoutesWithId` handler did. Because the editor load path hydrates `root.props` *from* those columns and lets them win (see 0.6.22), edits made through Puck root fields reverted on the next load or publish. The create/update handlers now map `root.props` → Payload fields, mirroring the standalone handler.
- The configured `rootPropsMapping` is now plumbed into both editor load views (`mapPayloadFieldsToRootProps`), so **custom** mappings round-trip symmetrically rather than only the built-in defaults. The homepage-swap check now reads the merged value, so it works whether `isHomepage` arrives as a top-level field or via `root.props`.

### Changed

- Bumped Puck dependencies: `@puckeditor/core` (dev) and `@puckeditor/plugin-heading-analyzer` to `^0.21.2` (performance improvements, no breaking changes), and `@puckeditor/plugin-ai` / `@puckeditor/cloud-client` to `^0.7.0`. The 0.7.0 releases are backward-compatible additive changes (plugin-ai gains optional message attachments and a widened `onSubmit` signature; cloud-client extracts a named `PuckAiOptions` type, makes `puckHandler`'s `options` optional, and adds an `./experimental` subpath). No code changes were required and the peer range (`@puckeditor/core` `>=0.21.0`) is unchanged.

### Docs

- Added a light/dark theme toggle to the documentation site. It defaults to the visitor's OS `prefers-color-scheme`, persists the choice to `localStorage`, and is applied before first paint to avoid a flash. ([#9](https://github.com/delmaredigital/payload-puck/issues/9))

## [0.6.25] - 2026-05-16

### Changed

- Bumped `payload`, `@payloadcms/next`, `@payloadcms/ui` dev dependencies to `^3.84.1` (from 3.79.0). Picks up patched transitives (`ajv` 8.18.0, `lodash` 4.18.1, `fast-uri` 3.1.2), clearing the high-severity lodash code-injection and fast-uri path-traversal/host-confusion CVEs from the dev tree. Peer dependency range (`>=3.69.0`) is unchanged — consumers are unaffected.

## [0.6.24] - 2026-05-16

### Changed

- Bumped `next` dev dependency to `^16.2.6` to clear [CVE-2026-44574](https://github.com/vercel/next.js/security/advisories/GHSA-492v-c6pp-mqqv) (middleware/proxy bypass via dynamic route parameter injection). The plugin itself ships no middleware and is not exploitable, but the dev-dep range was inside the vulnerable window.
- Documented the CVE in the README requirements so consumers using Next.js middleware know the minimum patched versions (15.5.16 / 16.2.5, or 15.5.18 / 16.2.6 for Turbopack).

## [0.6.23] - 2026-04-06

### Fixed

- **Security: API endpoints now enforce collection access control.** Previously, all Puck CRUD endpoints (`/api/puck/:collection/*`) bypassed collection-level access rules because they used Payload's local API with the default `overrideAccess: true`. The `access` config passed to `createPuckPlugin()` had no effect on these endpoints — unauthenticated users could read, create, update, and delete documents. All endpoint handlers now pass `overrideAccess: false` and forward `req` so Payload evaluates access rules against the current user. ([#7](https://github.com/delmaredigital/payload-puck/issues/7))

### Added

- **Locale-aware editing.** The Puck editor now propagates the active locale through save, publish, version history, and restore operations, enabling multi-language content management. Locale is resolved from the request body, query params, or Payload middleware. ([#6](https://github.com/delmaredigital/payload-puck/pull/6) — thanks [@georgisoft2020](https://github.com/georgisoft2020))
- **Version restore endpoint fix.** The version history UI now correctly calls `/restore` instead of `/versions` for restore operations. ([#6](https://github.com/delmaredigital/payload-puck/pull/6))

## [0.6.22] - 2026-03-31

### Fixed

- Editor now hydrates root.props from Payload fields when loading a page. Previously, saved values like `pageLayout`, `isHomepage`, conversion settings, and SEO fields were only stored in Payload columns during save but never read back into `puckData.root.props` on load. This caused the editor UI to show default values instead of the actual saved settings, and re-saving would overwrite the correct values with defaults.

## [0.6.21] - 2026-03-20

### Fixed

- Editor preview now defaults to dark mode when the active layout has `editorDarkMode: true`. Previously, the preview dark mode toggle always started as `false`, overriding the layout setting via the `??` operator. The toggle now reads the initial layout's `editorDarkMode` on mount.

## [0.6.20] - 2026-03-20

### Fixed

- `createPuckApiRoutesWithId` PATCH handler now accepts both `_status` and `status` in the request body. The editor sends `_status` (Payload convention) but the handler only read `status`, causing publish to silently fail. Pages remained in draft despite clicking Publish.

## [0.6.19] - 2026-03-12

### Fixed

- Multiple `createPuckPlugin()` instances now work correctly together. Previously, each instance overwrote the previous one's endpoint registrations and `custom.puck` config, causing only the first collection's API routes to function. Collections are now merged across plugin instances, parameterized endpoints are deduplicated, and shared config is preserved. ([#5](https://github.com/delmaredigital/payload-puck/issues/5))

## [0.6.17] - 2026-03-09

### Added

#### Email Builder

First-class email building with Puck. 12 email-safe components using table-based layouts with inline styles for maximum client compatibility.

**New export paths:**
- `@delmaredigital/payload-puck/email` — `EmailRenderer`, `renderToEmailHtml()`, `getEmailDocumentParts()`, `emailBaseConfig`, `emailEditorConfig`
- `@delmaredigital/payload-puck/email/components` — Individual email component configs (server, editor, and types)

**Email components:** EmailWrapper, EmailSection, EmailColumns, EmailHeading, EmailText, EmailButton, EmailImage, EmailSpacer, EmailDivider, EmailHeader, EmailFooter, EmailSocial

**Dual config system:** `emailBaseConfig` (server-safe, for rendering) and `emailEditorConfig` (interactive, for Puck editor) — mirrors the existing web page config architecture.

**Rendering pipeline:**
- `EmailRenderer` — React component wrapping Puck's `<Render>` with `emailBaseConfig`
- `renderToEmailHtml(data, options?)` — Produces complete email HTML document string via `renderToStaticMarkup`
- `getEmailDocumentParts(options)` — Returns `{ before, after }` HTML shell for custom wrapping

**Email CSS converters** added to `src/fields/shared.ts`:
- `colorValueToEmailCSS()` — Hex-only output, bakes opacity by blending with white
- `paddingValueToEmailCSS()` — Always outputs px values
- `backgroundValueToEmailCSS()` — Solid color only (gradients fall back to first stop)

**Utilities** in `src/components/email/utils.ts`:
- `tiptapHtmlToEmailHtml()` — Converts TipTap HTML to inline-styled email-safe HTML
- `vmlBackgroundOpen()` / `vmlBackgroundClose()` — Outlook VML background image support
- `TABLE_ATTRS`, `FULL_WIDTH_TABLE_STYLE`, `centeredTableStyle()` — Table layout helpers
- `WEB_SAFE_FONTS` — Font stack options for email

## [0.6.15] - 2026-02-19

### Changed

#### Puck AI 0.6.0 Upgrade

Bumped `@puckeditor/plugin-ai` and `@puckeditor/cloud-client` from `^0.5.0` to `^0.6.0`. This is an additive update — no APIs were removed. The Puck packages now use Vercel AI SDK v6 internally (up from v5); payload-puck does not import from `ai` directly, so this is transparent.

### Added

#### `prepareRequest` Callback for AI Requests

New option to intercept and modify outgoing AI requests before they're sent. Useful for adding custom headers, credentials, or body data.

```typescript
<PuckEditor
  enableAi={true}
  aiOptions={{
    prepareRequest: (opts) => ({
      ...opts,
      headers: { ...opts.headers, 'X-Custom': 'value' },
    }),
  }}
/>
```

Available on `PuckEditor` `aiOptions`, `createAiPlugin()`, and `AiPluginOptions`.

#### `scrollTracking` Option for AI Chat

New boolean option to control automatic scroll tracking in the AI chat panel.

```typescript
<PuckEditor
  enableAi={true}
  aiOptions={{
    scrollTracking: true,
  }}
/>
```

#### Tool `mode` Property

AI tools now support a `mode` property (`"auto" | "preload" | "inline"`) that controls how the tool is executed by the AI.

```typescript
const tools = {
  getProducts: {
    description: 'Fetch products',
    inputSchema: z.object({}),
    mode: 'preload', // Load results before generation
    execute: async () => payload.find({ collection: 'products' }),
  },
}
```

Supported in `createPuckAiApiRoutes`, `createAiGenerate`, and the Payload endpoint handler.

#### Tool `outputSchema` Property

AI tools can now define an `outputSchema` (Zod schema) to type-check tool return values.

#### `onFinish` Callback for AI Generation

New callback on all server-side AI paths, invoked when generation completes with usage metrics:

```typescript
createPuckPlugin({
  ai: {
    enabled: true,
    onFinish: ({ totalCost, tokenUsage }) => {
      console.log(`Cost: $${totalCost}, tokens: ${tokenUsage.totalTokens}`)
    },
  },
})
```

The `tokenUsage` object includes `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, and `cachedInputTokens`.

Available on `createPuckPlugin` AI config, `createPuckAiApiRoutes`, `createAiGenerate`, and the Payload endpoint handler.

#### Component AI `exclude` Property

Components can now be fully excluded from AI generation:

```typescript
const aiConfig = {
  MyInternalComponent: {
    ai: { exclude: true },
  },
}
```

Supported in `injectAiConfig()` overrides and the `AiComponentConfig` type.

#### Component AI `defaultZone` Property

Components can now configure default zone behavior for AI generation:

```typescript
const aiConfig = {
  Section: {
    ai: {
      defaultZone: { allow: ['Text', 'Heading'], disallow: ['Image'] },
    },
  },
}
```

#### Field AI `bind` Property

Fields can now specify a `bind` value for AI field binding:

```typescript
fields: {
  title: {
    ai: { bind: 'heading' },
  },
}
```

#### Field AI `stream` Property

Fields can now opt into streaming AI generation with `stream: boolean`.

### Deprecated

- `AiComponentConfig.schema` — use component-level AI instructions instead

---

## [0.6.14] - 2026-01-28

### Fixed

#### Reduced Published Package Size

Disabled source maps (`.js.map`) and declaration maps (`.d.ts.map`) from the published package. These files doubled the unpacked size and served no purpose since source files are no longer included in the package.

#### Package Exports Pointing to Source Files

Fixed issue where the published package's `exports` field pointed to TypeScript source files (`src/`) instead of compiled JavaScript (`dist/`). This caused "Unknown module type" errors with Turbopack. Changed to point `exports` directly to `dist/`.

---

## [0.6.13] - 2026-01-28

### Changed

#### Build System Migration to SWC

Migrated from pure TypeScript compilation to SWC for faster builds:

- **Build time**: Significantly faster compilation (~85ms vs several seconds with tsc)
- **TypeScript**: Now only emits declaration files (`.d.ts`)

Build commands remain the same:
```bash
pnpm build      # Full build (SWC + types)
pnpm dev        # Watch mode with SWC
```

---

## [0.6.12] - 2026-01-24

### Added

#### Custom Preview URL Support

Added `previewUrl` plugin option to customize the "View" button in the editor. By default, the View button navigates to `/{slug}`. This option enables custom URL patterns for multi-tenant apps, preview environments, or non-standard routing.

```typescript
// Static prefix for all pages
createPuckPlugin({
  previewUrl: '/preview',
})

// Organization-scoped pages (multi-tenant)
createPuckPlugin({
  previewUrl: (page) => {
    const orgSlug = page.organization?.slug || 'default'
    return (slug) => slug ? `/${orgSlug}/${slug}` : `/${orgSlug}`
  },
})
```

When `previewUrl` is a function, page data is fetched with `depth: 1` to populate relationships like `organization`.

## [0.6.10] - 2025-01-23

### Changed

#### `legacyRenderer` Now Optional on HybridPageRenderer

The `legacyRenderer` prop is now optional for new projects that will only have Puck pages. Previously it was required even when there were no legacy blocks to render.

```typescript
// Before: required even for new projects
<HybridPageRenderer
  page={page}
  config={baseConfig}
  legacyRenderer={() => null}  // unnecessary boilerplate
/>

// After: optional for Puck-only projects
<HybridPageRenderer page={page} config={baseConfig} />
```

For migration projects with existing Payload blocks, provide `legacyRenderer` as before—behavior is unchanged.

### Fixed

#### Preview Modal Not Rendering Custom Components

Fixed a bug where the full-screen preview modal (opened via the "Preview" button) would show only the header/footer but no page content.

**Root cause:** The `PreviewModal` component was not passing the Puck `config` to `PageRenderer`, causing it to fall back to `baseConfig` which doesn't include custom components.

**The fix:** Added `config` prop to `PreviewModal` and passed it through from `PuckEditorImpl` to `PageRenderer`.

#### Preview Modal Now Strips Editor-Only Props

Fixed an issue where editor-only props (like `editorPreviewFilter` used for panel sync) would persist in component data and affect how the preview rendered, causing interactive features like gallery filter tabs to not respond to user clicks.

**The fix:** `PreviewModal` now strips known editor-only props from the data before passing it to `PageRenderer`, ensuring the preview renders as it would on the actual frontend.

### Added

#### Preview Theme Context for Reactive Dark Mode Detection

Added `PuckPreviewThemeContext` and `usePuckPreviewTheme()` hook to allow Puck components to reactively respond to the preview dark mode toggle without polling or MutationObserver hacks.

**The problem:** When users toggle dark mode in the Puck editor preview, CSS dark mode variants work correctly (via `data-theme` attribute), but JavaScript-based theme detection would fail due to race conditions with component remounting.

**The solution:** IframeWrapper now provides a React Context with the current dark mode state, which components can consume directly.

```typescript
import { usePuckPreviewTheme, PuckPreviewThemeContext } from '@delmaredigital/payload-puck/editor'

function MyComponent() {
  const previewTheme = usePuckPreviewTheme()

  // previewTheme is:
  // - null: not in editor (use DOM-based detection)
  // - boolean: in editor, indicates dark mode state

  const isDark = previewTheme !== null
    ? previewTheme
    : document.documentElement.getAttribute('data-theme') === 'dark'

  // Now render based on isDark...
}
```

This is particularly useful for components that need to dynamically change JavaScript-controlled styles (like overlay colors) based on the preview theme.

### Fixed

#### Rich Text Dropdown Controls Not Syncing Changes (Supersedes 0.6.4 Workaround)

Fixed the root cause of rich text dropdown controls (font size, text color, highlight) not triggering Puck's dirty state or updating the preview.

**What was happening:**
1. User clicks our dropdown (font size, color picker, etc.)
2. Focus moves from TipTap editor to the dropdown
3. Puck's blur handler checks: `e.relatedTarget?.closest("[data-puck-rte-menu]")`
4. Our dropdown didn't have this attribute, so Puck cleared `currentRichText`
5. All menu controls lost their editor reference, including native Puck ones like HeadingSelect
6. Changes were silently dropped due to Puck's `isFocused` guard

**The fix:** Add `data-puck-rte-menu` attribute to our dropdown content so Puck recognizes it as part of the rich text menu.

**What changed:**
- Dropdown controls now use `@radix-ui/react-popover` (matches Puck's pattern)
- Added `data-puck-rte-menu` attribute for Puck's focus management
- Removed the `forcePuckUpdate()` workaround from 0.6.4 (no longer needed)
- Fixed React warning about mixing border shorthand/non-shorthand properties

**Note:** The 0.6.4 release incorrectly identified this as a Puck core issue. It was actually a bug in our own code—missing the focus preservation attribute that Puck requires.

### Removed

- `docs/PUCK_CORE_RICH_TEXT_ISSUE.md` - This document incorrectly blamed Puck for an issue in our own code

## [0.6.4] - 2026-01-19

This release adds homepage swap functionality and fixes several issues with rich text editing, hook merging, and editor iframe styling.

### Added

#### Homepage Swap Functionality

When attempting to set a page as the homepage and another page already has that designation, the editor now shows a confirmation dialog offering to swap homepages. This provides a much better UX than simply failing with an error.

**How it works:**
1. User checks "Is Homepage" on a page
2. If another page is already the homepage, a dialog appears: "Page X is currently the homepage. Would you like to swap?"
3. If confirmed, the old homepage is unset and the new one is set atomically

**New exports:**
```typescript
import {
  createIsHomepageUniqueHook,
  HomepageConflictError,
  unsetHomepage,
} from '@delmaredigital/payload-puck'
```

#### `getPuckCollectionConfig()` Helper

New helper function that returns both fields AND hooks for hybrid collection integration. This ensures the `isHomepage` uniqueness hook is included when using the field.

```typescript
import { getPuckCollectionConfig } from '@delmaredigital/payload-puck'

const { fields, hooks } = getPuckCollectionConfig({
  includeIsHomepage: true,  // Includes uniqueness hook automatically
  includeSEO: true,
})

export const Pages: CollectionConfig = {
  slug: 'pages',
  hooks: {
    beforeChange: [
      ...(hooks.beforeChange ?? []),
      // Your other hooks...
    ],
  },
  fields: [
    { name: 'title', type: 'text' },
    ...fields,
  ],
}
```

#### Custom Plugin Rails Support

The `PuckEditor` component now accepts a `plugins` prop for custom Puck plugins. This enables adding custom panels to the plugin rail.

### Fixed

#### Rich Text Style Changes Not Triggering Dirty State

Fixed an issue where changing font size, text color, or highlights via dropdown controls wouldn't mark the editor as having unsaved changes. The root cause is a focus state race condition in Puck core's `useSyncedEditor` hook. This release includes a workaround that forces Puck to recognize the changes.

See `docs/PUCK_CORE_RICH_TEXT_ISSUE.md` for technical details.

#### Dark Mode Styling for Font Size Buttons

Fixed white-on-white text in the font size dropdown and custom size input when Payload admin is in dark mode.

#### Hook Merging in `generatePagesCollection`

Fixed a bug where the `isHomepage` uniqueness hook wasn't being triggered because:
1. When generating a new collection, the spread operator was overwriting the entire hooks object instead of merging arrays
2. When augmenting an existing collection, hooks weren't being added at all

#### Editor Iframe Stylesheet Loading

Fixed FOUC (Flash of Unstyled Content) in the editor iframe by forcing a browser repaint after stylesheets finish loading. The fix uses Puck's `waitForStyles` option combined with a forced repaint via opacity toggle.

#### `isHomepage` Field Not Saving

Fixed `isHomepage` field not being included in save/publish requests from the editor.

#### `./next` Export Not Working with `next.config.ts`

Fixed the `@delmaredigital/payload-puck/next` import failing when used in TypeScript Next.js configs (`next.config.ts`). The export now includes a `default` condition to support all module resolution strategies.

### Changed

- `TemplateField` now uses Puck's `getItemById` API instead of manual tree traversal for accessing slot content, simplifying the code significantly

### Documentation

- Added `docs/PUCK_CORE_RICH_TEXT_ISSUE.md` documenting the Puck core focus state issue and our workaround

---

## [0.6.3] - 2026-01-18

This release adds build-time CSS compilation for production deployments and fixes dark mode issues in Payload admin.

### Added

#### Build-Time CSS Compilation for Production

The `editorStylesheet` runtime compilation works great in development, but fails on serverless platforms (Vercel, Netlify, etc.) because source CSS files aren't deployed. This release adds `withPuckCSS()` - a Next.js config wrapper that compiles your CSS at build time.

**The problem:**
- Runtime CSS compilation reads source files (e.g., `src/app/globals.css`) at request time
- Serverless deployments only include compiled `.next` output, not source files
- Result: broken editor styles in production

**The solution:**
```javascript
// next.config.js
import { withPuckCSS } from '@delmaredigital/payload-puck/next'
import { withPayload } from '@payloadcms/next/withPayload'

export default withPuckCSS({
  cssInput: 'src/app/(frontend)/globals.css',
})(withPayload(nextConfig))
```

```typescript
// payload.config.ts
createPuckPlugin({
  editorStylesheet: 'src/app/(frontend)/globals.css',      // For dev (runtime)
  editorStylesheetCompiled: '/puck-editor-styles.css',     // For prod (static)
})
```

**How it works:**
1. During `next build`, the wrapper compiles your CSS to `public/puck-editor-styles.css`
2. In production, the plugin serves the static file instead of runtime compilation
3. In development, runtime compilation continues working for hot reload

**New exports:**
```typescript
import { withPuckCSS, getPuckCSSPath } from '@delmaredigital/payload-puck/next'
```

**New plugin options:**
- `editorStylesheetCompiled` - Path to pre-compiled CSS file for production (e.g., `/puck-editor-styles.css`)

### Fixed

#### Dark Mode Form Input Visibility

Fixed white-on-white text in Puck form inputs when Payload CMS is in dark mode. Puck's UI is always light-themed, but when nested inside Payload's dark mode admin, form inputs were inheriting white text color. The DarkModeStyles component now explicitly forces dark text in all Puck UI elements.

#### Editor Stylesheet Loading

Fixed editor iframe stylesheets not applying immediately on load. The compiled CSS (from `editorStylesheet` or `editorStylesheetCompiled`) now properly triggers a re-render when loaded, ensuring Tailwind classes and CSS variables are applied without requiring a dark mode toggle.

---

## [0.6.2] - 2026-01-17

This release adds dark mode support for the Puck editor and includes several bug fixes.

### Added

#### Dark Mode Support

The Puck editor now automatically detects PayloadCMS dark mode and applies CSS overrides to fix visibility issues (white-on-white text). Also includes a preview toggle to test how pages look in both light and dark modes.

**Features:**
- **Auto-detection**: Detects `.dark` class on `document.documentElement` (PayloadCMS) or `prefers-color-scheme: dark` (OS preference)
- **Preview toggle**: Sun/Moon toggle in the header to switch preview iframe between light/dark modes
- **CSS overrides**: Injects Puck color variable overrides when dark mode is detected

**New components:**
- `DarkModeStyles` - Injects Puck color variable overrides when dark mode detected
- `PreviewModeToggle` - Toggle for switching preview iframe dark/light mode
- `useDarkMode` hook - Detects dark mode from class or media query

**New props on `PuckEditor`:**
- `autoDetectDarkMode` (default: `true`) - Enable automatic dark mode detection for editor UI
- `showPreviewDarkModeToggle` (default: `true`) - Show light/dark toggle for preview iframe
- `initialPreviewDarkMode` (default: `false`) - Initial dark mode state for preview iframe

```typescript
<PuckEditor
  autoDetectDarkMode={true}           // Auto-detect PayloadCMS dark mode
  showPreviewDarkModeToggle={true}    // Show sun/moon toggle
  initialPreviewDarkMode={false}      // Start preview in light mode
/>
```

New exports from `@delmaredigital/payload-puck/editor`:
```typescript
import {
  DarkModeStyles,
  PreviewModeToggle,
  useDarkMode,
} from '@delmaredigital/payload-puck/editor'
```

#### createRenderLayouts Utility

New utility to strip header/footer from layouts for rendering. Use this when your host app already provides a global header/footer via its root layout:

```typescript
import { HybridPageRenderer, createRenderLayouts } from '@delmaredigital/payload-puck/render'
import { siteLayouts } from '@/lib/puck-layouts'

// Strip header/footer for rendering (host app provides them)
const renderLayouts = createRenderLayouts(siteLayouts)
```

This keeps header/footer in editor layouts for realistic preview while avoiding double headers when rendering.

Also exported from `@delmaredigital/payload-puck/layouts`.

### Fixed

- **Homepage preview URL**: Preview button now correctly navigates to `/` for pages marked as homepage instead of using the page slug
- **Editor iframe stylesheet URLs**: Relative stylesheet URLs (like `/api/puck/styles`) now resolve correctly in the Puck editor iframe, fixing broken styles when using `editorStylesheets` prop
- **Editor iframe data-theme attribute**: IframeWrapper now sets `data-theme` attribute in addition to CSS classes, fixing styles for projects using `[data-theme='dark']` selectors (common with shadcn/ui, Next.js themes)
- **CSS compilation now uses project's postcss.config**: The `/api/puck/styles` endpoint now loads the project's `postcss.config.js` via `postcss-load-config`, ensuring all plugins and configuration are properly applied. Falls back to direct Tailwind import if config loading fails.
- **MediaField styling**: Fixed border CSS syntax and resolved nested interactive element warning by replacing `<button>` with `<span>` inside the file input label

### Notes

**Fonts in Editor Preview**: If your project uses custom fonts loaded via `next/font` (like Google Fonts or local fonts), these won't automatically appear in the editor iframe. Add the font URLs to `editorStylesheetUrls`:

```typescript
createPuckPlugin({
  editorStylesheet: 'src/app/globals.css',
  editorStylesheetUrls: [
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&display=swap'
  ],
})
```

---

## [0.6.1] - 2026-01-17

This patch release fixes editor state synchronization and adds quality-of-life improvements for page-tree integration and TypeScript.

### Added

#### Payload Fields Sync to Editor Root Props

When loading a page in the editor, Payload document fields are now properly synced to Puck's root.props:

- `isHomepage`, `title`, `slug`, `pageLayout` now load correctly
- SEO fields (`meta.title`, `meta.description`, `meta.image`) are synced
- Page-tree fields (`folder`, `pageSegment`) are synced

New exports:
```typescript
import { mapPayloadFieldsToRootProps } from '@delmaredigital/payload-puck/api'

// Reverse-map Payload fields back to root.props format
const rootProps = mapPayloadFieldsToRootProps(payloadDocument)
```

#### Locked PageSegmentField for Page-Tree

The page segment field is now locked by default in page-tree mode to prevent accidental URL changes:

- Lock icon appears in the field header
- Click to unlock and enable editing
- Warning message displayed when unlocked: "Changing may break existing links"
- Matches behavior of slug and isHomepage fields

New exports:
```typescript
import {
  LockedPageSegmentField,
  createLockedPageSegmentField,
} from '@delmaredigital/payload-puck/fields'

// For custom page-tree implementations
const field = createLockedPageSegmentField({
  label: 'Page Segment',
  warningMessage: 'Changing may break existing links',
})
```

#### Server Component Type Safety

New TypeScript types for server-only Puck configs reduce field definition pressure:

```typescript
import type { ServerComponentConfig, SlotField } from '@delmaredigital/payload-puck/config'

// No fields required for components without slots
export const ButtonConfig: ServerComponentConfig<ButtonProps> = {
  label: 'Button',
  render: ({ text }) => <button>{text}</button>,
}

// Only slot fields needed for container components
export const SectionConfig: ServerComponentConfig<SectionProps> = {
  fields: { content: { type: 'slot' } },
  render: ({ content: Content }) => <section><Content /></section>,
}
```

#### HybridPageRenderer Improvements

Type safety improvements for hybrid rendering:

- Generic type parameter for typed `legacyRenderer` blocks
- `toHybridPageData()` helper to convert Payload's generic JSON types
- `HybridPageDataInput` type for loose input

```typescript
import {
  HybridPageRenderer,
  toHybridPageData,
  type HybridPageDataInput,
} from '@delmaredigital/payload-puck/render'

// Typed legacy blocks
<HybridPageRenderer<NonNullable<Page['layout']>>
  page={toHybridPageData(page)}
  config={config}
  legacyRenderer={(blocks) => <RenderBlocks blocks={blocks} />}
/>
```

#### AnimatedWrapper Export

`AnimatedWrapper` component is now exported from the components entry point:

```typescript
import { AnimatedWrapper } from '@delmaredigital/payload-puck/components'
```

### Fixed

- **Editor field sync**: Fields like `isHomepage`, `title`, `pageLayout` now correctly load from Payload documents into the editor root.props
- **Editor stylesheet passthrough**: `editorStylesheets` from plugin config now properly passed to `PuckEditor`

### Changed

- Page-tree integration now uses `createLockedPageSegmentField()` instead of `createPageSegmentField()` by default

---

## [0.6.0] - 2026-01-15

This release significantly enhances AI-assisted page generation and introduces a rewritten RichText field implementation.

> **Note:** AI integration is still in early stages and under active development. Expect changes as we refine the integration.

### Breaking Changes

#### RichText Field API Change

The TipTap field exports have been replaced with a new RichText field API using Puck's native richtext with custom extensions.

**Removed exports:**
- `TiptapField`, `createTiptapField`
- `TiptapModal`
- `TiptapModalField`, `createTiptapModalField`

**Migration:**
```typescript
// Before
import { createTiptapField } from '@delmaredigital/payload-puck/fields'

const content = createTiptapField({ label: 'Content' })

// After
import { createRichTextField } from '@delmaredigital/payload-puck/fields'

const content = createRichTextField({ label: 'Content' })
```

**New preset options:**
```typescript
import {
  createRichTextField,      // Full customization
  fullRichTextField,        // All features enabled
  minimalRichTextField,     // Basic formatting only
  sidebarRichTextField,     // Optimized for Puck sidebar
} from '@delmaredigital/payload-puck/fields'
```

### Added

#### AI Integration Enhancements

##### Comprehensive Component Instructions

The AI now receives detailed instructions for all built-in components, teaching it:
- Correct field names (e.g., Button uses `text` not `label`, `link` not `href`)
- Component composition patterns (Section → Flex → Heading + Text + Button)
- Page structure best practices (Hero → Features → FAQ → CTA flow)
- Semantic HTML element selection

This dramatically improves generation quality—the AI now creates complete multi-section pages instead of minimal layouts.

**New exports:**
```typescript
import {
  comprehensiveComponentAiConfig,  // Full component instructions
  pagePatternSystemContext,        // System context with page patterns
} from '@delmaredigital/payload-puck/ai'
```

##### Dynamic Business Context Collection

Business context can now be managed through Payload admin instead of hardcoded in config:

```typescript
createPuckPlugin({
  ai: {
    enabled: true,
    contextCollection: true,  // Creates puck-ai-context collection
  },
})
```

The `puck-ai-context` collection includes:
- **name** - Context entry name (e.g., "Brand Guidelines")
- **content** - Markdown content for the AI
- **category** - Categorization (brand, tone, product, industry, technical, patterns, other)
- **enabled** - Toggle to include/exclude from AI prompts
- **order** - Sort order in the prompt

##### Context Editor Plugin

When `contextCollection: true`, a new "AI Context" panel appears in the Puck plugin rail:

- View all context entries with enable/disable toggles
- Create new entries with name, category, and markdown content
- Edit existing entries inline
- Delete entries with confirmation

```typescript
import { createContextEditorPlugin } from '@delmaredigital/payload-puck/ai'

const contextPlugin = createContextEditorPlugin({
  apiEndpoint: '/api/puck/ai-context',
  canCreate: true,
  canEdit: true,
  canDelete: true,
})
```

##### Context Hook

New React hook for managing AI context client-side:

```typescript
import { useAiContext } from '@delmaredigital/payload-puck/ai'

const { context, loading, error, create, update, remove, refetch } = useAiContext({
  apiEndpoint: '/api/puck/ai-context',
  includeDisabled: false,
})
```

#### Experimental Full Screen Canvas

New prop to enable Puck's experimental full-screen canvas mode:

```typescript
<PuckEditor experimentalFullScreenCanvas={true} />
```

#### New RichText Field Implementation

The RichText field has been rewritten using Puck's native richtext with custom TipTap extensions:

- **Font Sizes** - 9 presets with custom input support
- **Text Colors** - Theme-aware color picker with opacity
- **Highlights** - Background color highlighting
- **Inline Editing** - Edit directly on the canvas (no modal)

### Changed

- AI endpoint now combines static context (from config) + dynamic context (from collection) + page pattern system context
- `PuckEditor` uses `comprehensiveComponentAiConfig` by default when AI is enabled
- Context fetching is non-blocking—if collection doesn't exist or fetch fails, AI continues with static context only
- RichText component now uses Puck's native richtext internally instead of custom TipTap implementation

---

## [0.5.0] - 2026-01-14

### Breaking Changes

#### Puck 0.21 Package Scope Migration

Puck 0.21 introduced a breaking package scope change. All Puck packages have moved from `@measured/*` to `@puckeditor/*`.

**Peer dependency change:**
```json
// Before
"@measured/puck": ">=0.20.0"

// After
"@puckeditor/core": ">=0.21.0"
```

**Installation:**
```bash
# Before
pnpm add @delmaredigital/payload-puck @measured/puck

# After
pnpm add @delmaredigital/payload-puck @puckeditor/core
```

**Import changes for custom components:**
```typescript
// Before
import type { ComponentConfig } from '@measured/puck'

// After
import type { ComponentConfig } from '@puckeditor/core'
```

This plugin no longer supports Puck versions prior to 0.21.

### Added

#### Version History Plugin Rail

Version history has moved from a header dropdown to a dedicated plugin rail panel, utilizing Puck 0.21's new plugin rail API.

**What changed:**
- History icon now appears in the left plugin rail (alongside Blocks, Outline, Fields)
- Clicking opens a full sidebar panel instead of a dropdown
- Restore no longer triggers a page reload—uses Puck's `dispatch` to update editor state instantly
- Success message appears briefly after restore

**New exports:**
```typescript
import { createVersionHistoryPlugin } from '@delmaredigital/payload-puck/editor'

// For custom plugin configurations
const versionPlugin = createVersionHistoryPlugin({
  pageId: 'page-123',
  apiEndpoint: '/api/puck/pages',
  onRestoreSuccess: () => markEditorClean(),
})

<Puck plugins={[versionPlugin]} />
```

**Deprecations:**
- `VersionHistory` component export (use `createVersionHistoryPlugin` instead)
- `showVersionHistory` prop on `HeaderActions` (version history now lives in plugin rail)

#### Semantic HTML Elements

Layout components now support semantic HTML output for better SEO and accessibility. Each component has an "HTML Element" dropdown in the editor sidebar:

| Component | Available Elements |
|-----------|-------------------|
| **Section** | `section`, `article`, `aside`, `nav`, `header`, `footer`, `main`, `div` |
| **Flex** | `div`, `nav`, `ul`, `ol`, `aside`, `section` |
| **Container** | `div`, `article`, `aside`, `section` |
| **Grid** | `div`, `ul`, `ol` |

This enables proper document structure without wrapper elements:
- Use `<nav>` for navigation menus
- Use `<article>` for blog posts
- Use `<aside>` for sidebars
- Use `<ul>`/`<ol>` for list layouts

#### Full-Width Viewport Option

The editor now includes a "Full Width" (100%) viewport option alongside Mobile (360px), Tablet (768px), and Desktop (1280px). This helps preview how components behave at any viewport width.

#### Dynamic Accordion Defaults

The Accordion component now uses dynamic `defaultItemProps`:
- First item opens by default (`defaultOpen: true`)
- Items are numbered automatically ("Accordion Item 1", "Accordion Item 2", etc.)

#### ContentAlignmentField (D-Pad Positioning)

New visual 3x3 grid selector for content positioning within containers. Provides an intuitive d-pad style control for setting both horizontal and vertical alignment.

```typescript
import { createContentAlignmentField, alignmentToFlexCSS } from '@delmaredigital/payload-puck/fields'

const BannerConfig = {
  fields: {
    position: createContentAlignmentField({ label: 'Content Position' }),
  },
  render: ({ position }) => (
    <div style={{ display: 'flex', ...alignmentToFlexCSS(position) }}>
      {/* Content positioned at selected grid cell */}
    </div>
  ),
}
```

Helper functions:
- `alignmentToFlexCSS()` - For Flexbox containers
- `alignmentToGridCSS()` - For Grid containers
- `alignmentToPlaceSelfCSS()` - For individual grid items
- `alignmentToTailwind()` - Returns Tailwind classes

#### Unpublish Button

The editor header now includes an "Unpublish" link button that appears when viewing a published page. This allows reverting a published page back to draft status directly from the Puck editor, matching Payload's native document edit functionality.

#### Editor Stylesheet Injection

The Puck editor renders content in an iframe, which previously lacked access to your frontend CSS. New options enable stylesheet injection into the editor iframe:

**Plugin-level configuration:**
```typescript
createPuckPlugin({
  editorStylesheet: 'src/app/(frontend)/globals.css',  // Compiled with PostCSS/Tailwind
  editorStylesheetUrls: ['https://fonts.googleapis.com/...'],  // External stylesheets
})
```

This creates an endpoint at `/api/puck/styles` that compiles and serves your CSS (cached after first request).

**Component-level configuration:**
```typescript
<PuckConfigProvider
  config={editorConfig}
  editorStylesheets={['/api/puck/styles']}
  editorCss=":root { --custom: value; }"
/>

// Or per-layout in layout definitions
const layout: LayoutDefinition = {
  value: 'dark',
  editorStylesheets: ['/dark-theme.css'],
  editorCss: ':root { --background: #1a1a1a; }',
}
```

New props added to `PuckEditor`, `PuckConfigProvider`, and `LayoutDefinition`.

### Fixed

#### Server/Client Boundary Error

Fixed `getSizeClasses()` and `sizeValueToCSS()` being called from server components. These utilities have been moved to a server-safe module (`shared.ts`) to prevent the "Attempted to call client function from server" error when using the Button component with custom sizes in `PageRenderer`.

#### Publish Button Status

Fixed the Publish button not correctly setting `_status: 'published'` when publishing a draft page. The API now correctly omits the `draft` parameter when publishing to ensure Payload properly updates the document status.

#### Responsive Breakpoint Styles

Fixed responsive field styles not applying correctly at different breakpoints. Styles now properly cascade through Mobile, Tablet, and Desktop viewports.

#### Overflow Styling

Fixed overflow styling issues in layout components that could cause content clipping in certain configurations.

### Changed

- Internal imports updated from `@measured/puck` to `@puckeditor/core` (74 files)
- Plugin heading-analyzer import updated from `@measured/puck-plugin-heading-analyzer` to `@puckeditor/plugin-heading-analyzer`
- CSS import updated from `@measured/puck/puck.css` to `@puckeditor/core/puck.css`

### Notes

#### TipTap Implementation

This release evaluated Puck 0.21's built-in `richtext` field but retained the custom TipTap implementation. The custom implementation provides features not available in Puck's built-in:
- 9 font size presets with custom input
- Theme-aware color picker with opacity support
- Modal editing mode (full-screen expand)
- HTML source view/edit
- Auto-adapting colors for dark/light themes

The custom implementation uses standard TipTap packages (`@tiptap/react`, `@tiptap/starter-kit`, extensions) and official APIs—the customization is in the toolbar UI, not TipTap internals.

---

## [0.4.0] - 2026-01-12

### Breaking Changes

#### Unified PuckEditor Component

The editor component architecture has been simplified to a single `PuckEditor` component with built-in page-tree support.

**Removed exports:**
- `PuckEditorCore` - Use `PuckEditor` instead
- `PuckEditorClient` - Use `PuckEditor` instead

**Migration:**

```typescript
// Before
import { PuckEditorCore } from '@delmaredigital/payload-puck/editor'
// or
import { PuckEditorClient } from '@delmaredigital/payload-puck/client'

// After
import { PuckEditor } from '@delmaredigital/payload-puck/editor'
// or
import { PuckEditor } from '@delmaredigital/payload-puck/client'
```

The new `PuckEditor` component:
- Accepts `config` prop directly OR reads from `PuckConfigProvider` context
- Includes built-in page-tree support via `hasPageTree` prop
- Handles all save/publish functionality
- Includes dynamic loading to prevent hydration mismatches

### Added

#### Page-Tree Props on PuckEditor

For custom editor UIs using page-tree integration:

```typescript
<PuckEditor
  config={editorConfig}
  pageId={page.id}
  initialData={page.puckData}
  pageTitle={page.title}
  pageSlug={page.slug}
  apiEndpoint="/api/puck/pages"
  hasPageTree={true}           // Enable page-tree fields
  folder={page.folder}         // Initial folder ID
  pageSegment={page.pageSegment} // Initial page segment
/>
```

#### New Utility Exports

Page-tree field injection utilities exported from `/client` and `/editor`:

```typescript
import { injectPageTreeFields, hasPageTreeFields } from '@delmaredigital/payload-puck/client'

// Check if config already has page-tree fields
if (!hasPageTreeFields(config)) {
  config = injectPageTreeFields(config)
}
```

### Changed

- `PuckEditor` now supports both direct `config` prop and context-based config
- `PuckEditorView` (RSC) now renders `PuckEditor` directly instead of `PuckEditorClient`
- Page-tree field injection moved into `PuckEditor` component

---

## [0.3.0] - 2026-01-09

### Breaking Changes

#### Payload Admin UI Integration

The Puck editor now runs inside Payload's admin UI using `DefaultTemplate`. This provides a native admin experience with proper navigation, permissions, and styling.

**Migration:**
- Remove custom editor routes (`app/(manage)/pages/[id]/edit/page.tsx`)
- Remove custom editor layouts
- The plugin now auto-registers the editor view at `/admin/puck-editor/:collection/:id`
- "Edit with Puck" buttons in Payload admin now navigate to the integrated editor

#### PuckConfigProvider Pattern

The Puck configuration is now provided via React context instead of being passed directly to components.

**Before:**
```tsx
// app/(manage)/pages/[id]/edit/page.tsx
import { PuckEditor } from '@delmaredigital/payload-puck/editor'
import { editorConfig } from '@delmaredigital/payload-puck/config/editor'

<PuckEditor config={editorConfig} ... />
```

**After:**
```tsx
// app/(admin)/layout.tsx (or root layout)
import { PuckConfigProvider } from '@delmaredigital/payload-puck/client'
import { editorConfig } from '@delmaredigital/payload-puck/config/editor'

export default function Layout({ children }) {
  return (
    <PuckConfigProvider config={editorConfig}>
      {children}
    </PuckConfigProvider>
  )
}
```

The editor view automatically retrieves the config from context.

#### Build System Change

Migrated from tsup to tsc for simpler, more reliable builds.

- `tsup.config.ts` removed
- Build output structure unchanged
- No changes needed for consumers

### Added

#### Page-Tree Plugin Integration

Automatic integration with `@delmaredigital/payload-page-tree` when detected:

- **Auto-detection**: Checks if collection has `pageSegment` field (page-tree's signature)
- **Folder Picker Field**: Hierarchical folder selection in Puck sidebar
- **Page Segment Field**: Editable URL segment with live slugification
- **Slug Preview Field**: Read-only computed slug preview

When page-tree is active, the Puck editor sidebar shows:
```
Root Fields:
├── Page Title
├── Folder (picker dropdown with tree)
├── Page Segment (editable text, auto-slugified)
└── URL Slug (read-only preview)
```

**Configuration:**
```typescript
createPuckPlugin({
  // Auto-detect (default) - checks for pageSegment field
  pageTreeIntegration: undefined,

  // Explicitly enable with custom config
  pageTreeIntegration: {
    folderSlug: 'payload-folders',
    pageSegmentFieldName: 'pageSegment',
  },

  // Explicitly disable
  pageTreeIntegration: false,
})
```

#### New Field Exports

Three new custom Puck fields for page-tree integration:

```typescript
import {
  createFolderPickerField,
  createPageSegmentField,
  createSlugPreviewField,
} from '@delmaredigital/payload-puck/fields'

// Folder picker with hierarchical tree
const folderField = createFolderPickerField({
  label: 'Folder',
  folderSlug: 'payload-folders',
})

// Page segment with auto-slugification
const segmentField = createPageSegmentField({
  label: 'Page Segment',
})

// Read-only slug preview
const slugField = createSlugPreviewField({
  label: 'URL Slug',
  hint: 'Auto-generated from folder + page segment',
})
```

#### New Export Paths

- `@delmaredigital/payload-puck/client` - Client components including `PuckConfigProvider`
- `@delmaredigital/payload-puck/rsc` - React Server Component exports
- `@delmaredigital/payload-puck/admin/client` - Admin-specific client components

### Changed

- Editor view now uses `DefaultTemplate` from `@payloadcms/next/templates`
- API routes now support `folder` and `pageSegment` fields in save payload
- Folder picker includes "Manage folders" link to `/admin/page-tree`

### Fixed

- Folder picker dropdown now appears inline (fixed `position: relative`)
- Folder picker refreshes folder list when opened (catches newly created folders)
- "No folder" selection no longer breaks the dropdown

---

## [0.2.0] - 2026-01-09

### Breaking Changes

#### Section Component Redesign
The Section component now has a two-layer architecture for more powerful layout control:

- **Section layer** (outer, full-width): Controls the full-bleed background, border, padding, and margin
- **Content layer** (inner, constrained): Controls the content area with max-width, background, border, and padding

**Field renames:**
- `background` → `sectionBackground`
- `border` → `sectionBorder`
- `customPadding` → `sectionPadding`
- `margin` → `sectionMargin`

**New fields:**
- `contentDimensions` - Max-width, min-height for content area (default: 1200px centered)
- `contentBackground` - Background for the content area
- `contentBorder` - Border around the content area
- `contentPadding` - Padding inside the content area

**Removed fields:**
- `fullWidth` - No longer needed; set `contentDimensions` to full width instead

#### Container Component Simplified
The Container component has been simplified to a single-layer organizational wrapper:

**Removed fields:**
- `innerBackground` - Use Section for two-layer backgrounds
- `innerBorder` - Use Section for two-layer borders
- `innerPadding` - Now just `padding`

**Migration:** If you were using Container's inner/outer backgrounds, migrate to Section which now provides this functionality with clearer naming.

### Added

- Changelog file to track breaking changes and new features

### Fixed

- Slot/DropZone now expands to fill container's minHeight in the editor
- RichText component now fills available width (removed Tailwind prose max-width constraint)
- Removed hardcoded padding defaults across components; now properly set via defaultProps

### Changed

- Section component now provides full-bleed background with constrained content area out of the box
- Container component simplified for basic organizational use cases
- Better field grouping in the editor panel (Section styling → Content styling)
- Default content area max-width of 1200px makes the two-layer design immediately visible
