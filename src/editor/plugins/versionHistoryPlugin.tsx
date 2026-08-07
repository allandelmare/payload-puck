'use client'

import { createElement } from 'react'
import { History } from 'lucide-react'
import type { Data, Plugin } from '@puckeditor/core'
import { VersionHistoryPanel } from './VersionHistoryPanel.js'

export interface VersionHistoryPluginOptions {
  /**
   * Page ID to fetch versions for
   */
  pageId: string
  /**
   * API endpoint base path
   * @default '/api/puck/pages'
   */
  apiEndpoint?: string
  /**
   * Callback after successful restore (e.g., to mark editor as clean).
   * Receives the restored data that was dispatched into the editor.
   */
  onRestoreSuccess?: (restoredData?: Data) => void
}

/**
 * Creates a Puck plugin for version history
 *
 * Adds a "History" button to the plugin rail that opens a panel
 * showing version history with the ability to restore previous versions.
 *
 * @example
 * ```tsx
 * import { createVersionHistoryPlugin } from '@delmaredigital/payload-puck/editor'
 *
 * const versionPlugin = createVersionHistoryPlugin({
 *   pageId: 'page-123',
 *   apiEndpoint: '/api/puck/pages',
 *   onRestoreSuccess: () => markEditorClean(),
 * })
 *
 * <Puck plugins={[versionPlugin]} />
 * ```
 */
export function createVersionHistoryPlugin(options: VersionHistoryPluginOptions): Plugin {
  return {
    name: 'version-history',
    label: 'History',
    icon: createElement(History, { size: 20 }),
    render: () =>
      createElement(VersionHistoryPanel, {
        pageId: options.pageId,
        apiEndpoint: options.apiEndpoint,
        onRestoreSuccess: options.onRestoreSuccess,
      }),
  }
}
