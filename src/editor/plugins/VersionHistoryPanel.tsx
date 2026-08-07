'use client'

import { useState, useCallback, useEffect, memo, type CSSProperties } from 'react'
import { createUsePuck, type Data } from '@puckeditor/core'
import { Loader2, Check, RotateCcw, AlertCircle } from 'lucide-react'
import { useLocale } from '@payloadcms/ui';

// Create usePuck hook for accessing editor state and dispatch
const usePuck = createUsePuck()

/**
 * Version entry from Payload's versions system
 */
export interface PageVersion {
  id: string
  parent: string
  version: {
    title?: string
    slug?: string
    puckData?: Data
    _status?: 'draft' | 'published'
    updatedAt: string
    createdAt: string
  }
  createdAt: string
  updatedAt: string
  autosave?: boolean
  latest?: boolean
}

export interface VersionHistoryPanelProps {
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
   *
   * Receives the restored data that was dispatched into the editor, so the
   * caller can treat it as the new "last saved" baseline — the restore endpoint
   * has already persisted it server-side.
   */
  onRestoreSuccess?: (restoredData?: Data) => void
}

// Panel styles using Puck's CSS variables
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--puck-color-white)',
  } as CSSProperties,
  header: {
    padding: '16px',
    borderBottom: '1px solid var(--puck-color-grey-09)',
    flexShrink: 0,
  } as CSSProperties,
  headerTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--puck-color-grey-02)',
    margin: 0,
  } as CSSProperties,
  headerSubtitle: {
    fontSize: '12px',
    color: 'var(--puck-color-grey-05)',
    marginTop: '4px',
  } as CSSProperties,
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  } as CSSProperties,
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 16px',
    gap: '12px',
  } as CSSProperties,
  loadingIcon: {
    width: '24px',
    height: '24px',
    color: 'var(--puck-color-grey-05)',
    animation: 'spin 1s linear infinite',
  } as CSSProperties,
  loadingText: {
    fontSize: '14px',
    color: 'var(--puck-color-grey-05)',
  } as CSSProperties,
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 16px',
    gap: '8px',
  } as CSSProperties,
  errorIcon: {
    width: '32px',
    height: '32px',
    color: 'var(--puck-color-red-06)',
  } as CSSProperties,
  errorText: {
    fontSize: '14px',
    color: 'var(--puck-color-red-06)',
    textAlign: 'center',
  } as CSSProperties,
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 16px',
    gap: '8px',
  } as CSSProperties,
  emptyText: {
    fontSize: '14px',
    color: 'var(--puck-color-grey-05)',
    textAlign: 'center',
  } as CSSProperties,
  versionItem: {
    borderRadius: '8px',
    transition: 'background-color 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px',
    gap: '12px',
    marginBottom: '4px',
  } as CSSProperties,
  versionInfo: {
    flex: 1,
    minWidth: 0,
  } as CSSProperties,
  versionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  } as CSSProperties,
  versionDate: {
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--puck-color-grey-02)',
  } as CSSProperties,
  badge: {
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: '4px',
    padding: '2px 6px',
  } as CSSProperties,
  badgeCurrent: {
    backgroundColor: 'var(--puck-color-azure-11)',
    color: 'var(--puck-color-azure-04)',
  } as CSSProperties,
  badgePublished: {
    backgroundColor: 'var(--puck-color-green-11)',
    color: 'var(--puck-color-green-04)',
  } as CSSProperties,
  autosaveText: {
    fontSize: '11px',
    color: 'var(--puck-color-grey-06)',
    fontStyle: 'italic',
  } as CSSProperties,
  versionDetails: {
    fontSize: '12px',
    color: 'var(--puck-color-grey-05)',
    marginTop: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  restoreButton: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--puck-color-grey-04)',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    flexShrink: 0,
    background: 'none',
    border: '1px solid var(--puck-color-grey-08)',
    borderRadius: '6px',
    cursor: 'pointer',
  } as CSSProperties,
  restoreButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as CSSProperties,
  checkIcon: {
    width: '16px',
    height: '16px',
    color: 'var(--puck-color-azure-05)',
    flexShrink: 0,
  } as CSSProperties,
  successMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    backgroundColor: 'var(--puck-color-green-11)',
    borderRadius: '8px',
    marginBottom: '8px',
  } as CSSProperties,
  successText: {
    fontSize: '13px',
    color: 'var(--puck-color-green-03)',
    fontWeight: 500,
  } as CSSProperties,
}

/**
 * Version history panel for the Puck plugin rail
 *
 * Displays a list of previous versions with the ability to restore them.
 * Uses Puck's dispatch to update editor state without page reload.
 */
export const VersionHistoryPanel = memo(function VersionHistoryPanel({
  pageId,
  apiEndpoint = '/api/puck/pages',
  onRestoreSuccess,
}: VersionHistoryPanelProps) {
  const dispatch = usePuck((s) => s.dispatch)

  const [isLoading, setIsLoading] = useState(true)
  const [isRestoring, setIsRestoring] = useState(false)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const { code: currentLocale } = useLocale()

  // Fetch versions on mount
  const fetchVersions = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const url = `${apiEndpoint}/${pageId}/versions?limit=20${currentLocale ? `&locale=${currentLocale}` : ''}`;
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          setError('Version history is not available for this page.')
        } else {
          throw new Error('Failed to fetch versions')
        }
        return
      }
      const data = await response.json()
      // Handle both 'docs' (our API) and 'versions' (Payload direct) response formats
      setVersions(data.docs || data.versions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions')
      console.error('Error fetching versions:', err)
    } finally {
      setIsLoading(false)
    }
  }, [apiEndpoint, pageId])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  // Handle version restore
  const handleRestore = useCallback(
    async (version: PageVersion) => {
      if (!confirm(`Restore this version from ${formatDate(version.updatedAt)}? This will replace your current content.`)) {
        return
      }

      setIsRestoring(true)
      setError(null)
      setSuccessMessage(null)

      try {
        // Call restore endpoint
        const response = await fetch(`${apiEndpoint}/${pageId}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId: version.id, locale: currentLocale }),
        })

        if (!response.ok) {
          throw new Error('Failed to restore version')
        }

        const result = await response.json()
        const restoredDoc = result.doc

        // Update Puck editor state with restored data
        if (restoredDoc?.puckData) {
          dispatch({
            type: 'setData',
            data: restoredDoc.puckData,
          })
        }

        // Show success message
        setSuccessMessage(`Restored version from ${formatDate(version.updatedAt)}`)
        setTimeout(() => setSuccessMessage(null), 3000)

        // Notify parent to mark as clean, handing over the restored data so it
        // becomes the new saved baseline (the restore already persisted it).
        onRestoreSuccess?.(restoredDoc?.puckData)

        // Refresh version list
        fetchVersions()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to restore version')
        console.error('Error restoring version:', err)
      } finally {
        setIsRestoring(false)
      }
    },
    [apiEndpoint, pageId, dispatch, onRestoreSuccess, fetchVersions, currentLocale]
  )

  // Format date for display
  function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Format time for display
  function formatTime(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.headerTitle}>Version History</h3>
        {!isLoading && !error && versions.length > 0 && (
          <div style={styles.headerSubtitle}>
            {versions.length} version{versions.length !== 1 ? 's' : ''} available
          </div>
        )}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {/* Success message */}
        {successMessage && (
          <div style={styles.successMessage}>
            <Check style={{ width: '16px', height: '16px', color: 'var(--puck-color-green-04)' }} />
            <span style={styles.successText}>{successMessage}</span>
          </div>
        )}

        {isLoading ? (
          <div style={styles.loadingContainer}>
            <Loader2 style={styles.loadingIcon} />
            <span style={styles.loadingText}>Loading versions...</span>
          </div>
        ) : error ? (
          <div style={styles.errorContainer}>
            <AlertCircle style={styles.errorIcon} />
            <div style={styles.errorText as CSSProperties}>{error}</div>
          </div>
        ) : versions.length === 0 ? (
          <div style={styles.emptyContainer}>
            <div style={styles.emptyText as CSSProperties}>
              No version history available yet.
              <br />
              Versions are created when you save or publish.
            </div>
          </div>
        ) : (
          versions.map((version, index) => (
            <div
              key={version.id}
              style={{
                ...styles.versionItem,
                backgroundColor: hoveredIndex === index ? 'var(--puck-color-grey-11)' : 'transparent',
              }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Version info */}
              <div style={styles.versionInfo}>
                <div style={styles.versionHeader}>
                  <span style={styles.versionDate}>
                    {formatDate(version.updatedAt)}
                  </span>
                  {index === 0 && (
                    <span style={{ ...styles.badge, ...styles.badgeCurrent }}>
                      Current
                    </span>
                  )}
                  {version.version._status === 'published' && (
                    <span style={{ ...styles.badge, ...styles.badgePublished }}>
                      Published
                    </span>
                  )}
                  {version.autosave && (
                    <span style={styles.autosaveText}>
                      auto
                    </span>
                  )}
                </div>
                <div style={styles.versionDetails}>
                  {formatTime(version.updatedAt)}
                  {version.version.title && (
                    <span> &middot; {version.version.title}</span>
                  )}
                </div>
              </div>

              {/* Restore button (not for current version) */}
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => handleRestore(version)}
                  disabled={isRestoring}
                  style={{
                    ...styles.restoreButton,
                    ...(isRestoring ? styles.restoreButtonDisabled : {}),
                  }}
                  onMouseEnter={(e) => {
                    if (!isRestoring) {
                      e.currentTarget.style.backgroundColor = 'var(--puck-color-grey-10)'
                      e.currentTarget.style.borderColor = 'var(--puck-color-grey-07)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                    e.currentTarget.style.borderColor = 'var(--puck-color-grey-08)'
                  }}
                >
                  {isRestoring ? (
                    <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <RotateCcw style={{ width: '14px', height: '14px' }} />
                  )}
                  Restore
                </button>
              )}

              {/* Current indicator */}
              {index === 0 && (
                <Check style={styles.checkIcon} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
})
