# @delmaredigital/payload-puck

A PayloadCMS plugin for integrating [Puck](https://puckeditor.com) visual page builder. Build pages visually with drag-and-drop components while leveraging Payload's content management capabilities.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

> 🎨 **Upgrading to 0.8?** The editor stylesheet is now built by your app, not by this plugin.
>
> - **`editorStylesheet`, `editorStylesheetCompiled` and `editorStylesheetUrls` are replaced by a single `editorStylesheets: string[]`** — an ordered list of URLs the editor iframe loads. The `/api/puck/styles` endpoint, the `/next` entry point and its `withPuckCSS()` wrapper, and the `postcss` / `postcss-load-config` peer dependencies are all removed.
> - **Action:** install Tailwind's CLI (`pnpm add -D @tailwindcss/cli` on v4), add a `build:puck-css` script that compiles your CSS into `public/`, pass that URL via `editorStylesheets`, and delete the `withPuckCSS` wrapper from `next.config`. Full steps in [Upgrading to 0.8.0](#upgrading-to-080-breaking).
> - **Why it matters:** the old design compiled CSS at runtime in development but relied on a **webpack plugin** in production. Next.js 16 defaults to Turbopack, which never runs `webpack()` hooks — so on Next 16 the production stylesheet was silently never generated and **the editor rendered completely unstyled in production while looking perfect locally**. If you are on Next 16, this release fixes that. See the [CHANGELOG](./CHANGELOG.md#080---2026-08-07).

---

> 📦 **Upgrading from 0.6.x?** `0.7.0` raised two floors before the 0.8 changes above: **`@puckeditor/core` now requires `>= 0.23.0`** (`pnpm add @puckeditor/core@^0.23.0`) and **Node 18 is no longer supported** (`node >= 20.9.0`). Puck 0.23 also ships a rewritten canvas drag-and-drop engine and a redesigned outline, so the editing experience changes visibly even though no API you call has changed — worth a pass through your editor. Apply both this and the 0.8 migration; see the [CHANGELOG](./CHANGELOG.md#070---2026-08-07).

---

## Documentation

**[Full documentation &rarr;](https://delmaredigital.github.io/payload-puck/)**

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/delmaredigital/payload-puck)

Covers installation, configuration, components, custom fields, theming, layouts, dark mode, page-tree integration, hybrid integration, AI integration, and more.

---

## Install

```bash
pnpm add @delmaredigital/payload-puck @puckeditor/core
```

### Requirements

| Dependency | Version |
|------------|---------|
| `node` | >= 20.9.0 |
| `@puckeditor/core` | >= 0.23.0 |
| `payload` | >= 3.69.0 |
| `@payloadcms/next` | >= 3.69.0 |
| `next` | >= 15.4.8 (see security note below) |
| `react` | >= 19.2.1 |

> **Note:** Puck 0.21+ moved from `@measured/puck` to `@puckeditor/core`. This plugin requires the new package scope.

> **Security:** If your app uses Next.js middleware (or proxy.ts) to protect dynamic routes, use `next` >= 15.5.16 / 16.2.5 to pick up the fix for [CVE-2026-44574](https://github.com/vercel/next.js/security/advisories/GHSA-492v-c6pp-mqqv) (middleware bypass via dynamic route parameter injection). Turbopack users need >= 15.5.18 / 16.2.6.

### Upgrading to 0.8.0 (breaking)

**Editor CSS is now built by your app, not by this plugin.** Three options collapse into one, and `withPuckCSS` is gone.

Add a build step using Tailwind's own CLI. Tailwind v4 ships the CLI as a separate package:

```bash
pnpm add -D @tailwindcss/cli   # v4 only; v3 already provides the `tailwindcss` binary
```

```jsonc
// package.json — quote the paths; App Router route groups like (frontend) are shell syntax
"scripts": {
  "build:puck-css": "tailwindcss -i './src/app/(frontend)/globals.css' -o './public/puck-editor-styles.css'",
  "dev:puck-css": "tailwindcss -i './src/app/(frontend)/globals.css' -o './public/puck-editor-styles.css' --watch",
  "build": "pnpm build:puck-css && next build",
  "dev": "pnpm build:puck-css && next dev"
}
```

Add `public/puck-editor-styles.css` to `.gitignore` — it's a build artifact. Run `dev:puck-css` in a second terminal while actively editing theme CSS.

Then pass the URL:

```typescript
// before
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

Finally, remove the `withPuckCSS` import and wrapper from `next.config.js`, and drop any `editorStylesheets` prop on `PuckConfigProvider` — the plugin wires it through automatically now.

> **Why:** the old approach compiled CSS at runtime in dev and via a **webpack plugin** in production. Next.js 16 defaults to Turbopack, which never runs `webpack()` hooks — so the production stylesheet was silently never generated and the editor rendered unstyled, while local dev looked perfect. One artifact, built by your own toolchain, now resolves identically everywhere.

Also removed: the `/api/puck/styles` endpoint, the `/next` entry point, and the `postcss` / `postcss-load-config` peer dependencies.

### Upgrading to 0.7.0 (breaking)

`0.7.0` raises two floors. Both are a one-line change for most projects:

```bash
pnpm add @puckeditor/core@^0.23.0   # peer floor moved from >=0.21.0
```

- **`@puckeditor/core` now requires >= 0.23.0.** The Puck plugins this package bundles are versioned in lockstep with Puck core and import it from the host, so running them against an older core is not a supported combination. Puck 0.23 ships a rewritten canvas drag-and-drop engine and a redesigned outline — **the editing experience changes visibly**, even though no API you call has changed. Worth a pass through your editor after upgrading. See the [Puck 0.23 release notes](https://puckeditor.com/blog/puck-023).
- **Node 18 is no longer supported;** the floor is now `>=20.9.0`. Node 18 is end-of-life and Puck core 0.23 itself requires `>=20.0.0`.

No exports, props, or configuration options were removed or renamed. Full detail in the [changelog](./CHANGELOG.md).

---

## Quick Start

### 1. Add the Plugin

```typescript
// src/payload.config.ts
import { buildConfig } from 'payload'
import { createPuckPlugin } from '@delmaredigital/payload-puck/plugin'

export default buildConfig({
  plugins: [
    createPuckPlugin({
      pagesCollection: 'pages',
    }),
  ],
})
```

### 2. Provide Puck Configuration

```typescript
// app/(app)/layout.tsx
import { PuckConfigProvider } from '@delmaredigital/payload-puck/client'
import { editorConfig } from '@delmaredigital/payload-puck/config/editor'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PuckConfigProvider config={editorConfig}>
          {children}
        </PuckConfigProvider>
      </body>
    </html>
  )
}
```

### 3. Create a Frontend Route

```typescript
// app/(frontend)/[[...slug]]/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'
import { PageRenderer } from '@delmaredigital/payload-puck/render'
import { baseConfig } from '@delmaredigital/payload-puck/config'
import { notFound } from 'next/navigation'

async function getPage(slug?: string[]) {
  const payload = await getPayload({ config })
  const slugPath = slug?.join('/') || ''
  const { docs } = await payload.find({
    collection: 'pages',
    where: {
      and: [
        { _status: { equals: 'published' } },
        slugPath
          ? { slug: { equals: slugPath } }
          : { isHomepage: { equals: true } },
      ],
    },
    limit: 1,
  })
  return docs[0] || null
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = await getPage(slug)
  if (!page) notFound()
  return <PageRenderer config={baseConfig} data={page.puckData} />
}
```

That's it! The plugin registers the editor view, API endpoints, and "Edit with Puck" buttons automatically.

---

## Documentation

For everything else — components, custom fields, theming, layouts, dark mode, page-tree integration, hybrid integration, AI integration, advanced configuration, and the full export reference — see the [full documentation](https://delmaredigital.github.io/payload-puck/).

---

## License

MIT
