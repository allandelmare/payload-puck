import type { Access, CollectionConfig, Field } from 'payload'
import type { PuckPluginOptions } from '../../types/index.js'
import { DEFAULT_LAYOUTS } from '../../layouts/defaults.js'
import { layoutsToPayloadOptions } from '../../layouts/utils.js'
import {
  puckDataField,
  createEditorVersionField,
  createPageLayoutField,
  isHomepageField,
  seoFieldGroup,
  conversionFieldGroup,
} from '../fields/index.js'
import { createIsHomepageUniqueHook } from '../hooks/isHomepageUnique.js'

/**
 * Default access: anyone may read, only authenticated Payload users may write.
 *
 * Before 0.9.1 every operation defaulted to allow-all, so a plugin consumer who
 * passed no `access` shipped a pages collection that anonymous REST callers
 * could create, update and delete.
 */
const defaultReadAccess: Access = () => true
const defaultWriteAccess: Access = ({ req }) => Boolean(req.user)

/**
 * Generates a Pages collection configuration for Puck
 */
export function generatePagesCollection(
  slug: string,
  options: PuckPluginOptions
): CollectionConfig {
  const {
    collectionOverrides = {},
    access = {},
    layouts = DEFAULT_LAYOUTS,
    additionalFields = [],
  } = options

  // These keys are merged explicitly in the config below; only the remaining
  // override keys are spread verbatim.
  const MERGED_OVERRIDE_KEYS = new Set(['access', 'admin', 'hooks', 'versions', 'fields'])
  const restOverrides = Object.fromEntries(
    Object.entries(collectionOverrides).filter(([key]) => !MERGED_OVERRIDE_KEYS.has(key)),
  ) as Partial<CollectionConfig>

  const baseFields: Field[] = [
    // Core Fields (title and slug with duplication hooks - unique to collection generation)
    {
      name: 'title',
      type: 'text',
      required: true,
      hooks: {
        beforeDuplicate: [
          ({ value }) => {
            if (!value) return value
            const copyMatch = value.match(/^(.+) \(Copy(?: (\d+))?\)$/)
            if (copyMatch) {
              const baseName = copyMatch[1]
              const copyNum = copyMatch[2] ? parseInt(copyMatch[2], 10) + 1 : 2
              return `${baseName} (Copy ${copyNum})`
            }
            return `${value} (Copy)`
          },
        ],
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'URL path for this page (auto-generated from title)',
      },
      hooks: {
        beforeValidate: [
          ({ data, value }) => {
            if (data && !value && data.title) {
              return (data.title as string)
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .trim()
            }
            return value
          },
        ],
        beforeDuplicate: [
          ({ value }) => {
            if (!value) return value
            const copyMatch = value.match(/^(.+)-copy(?:-(\d+))?$/)
            if (copyMatch) {
              const baseName = copyMatch[1]
              const copyNum = copyMatch[2] ? parseInt(copyMatch[2], 10) + 1 : 2
              return `${baseName}-copy-${copyNum}`
            }
            return `${value}-copy`
          },
        ],
      },
    },

    // Page Layout
    createPageLayoutField(layouts, true),

    // Editor Version
    createEditorVersionField('puck', true),

    // Homepage Flag
    isHomepageField,

    // Puck Data (hidden - managed via visual editor)
    puckDataField,

    // SEO Fields
    seoFieldGroup,

    // Conversion Tracking Fields
    conversionFieldGroup,

    // Additional fields from options
    ...additionalFields,
  ]

  return {
    slug,
    admin: {
      useAsTitle: 'title',
      group: 'Content',
      defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
      ...(collectionOverrides.admin ?? {}),
    },
    access: {
      read: access.read ?? defaultReadAccess,
      create: access.create ?? defaultWriteAccess,
      update: access.update ?? defaultWriteAccess,
      delete: access.delete ?? defaultWriteAccess,
      ...(access.readVersions ? { readVersions: access.readVersions } : {}),
      ...(collectionOverrides.access ?? {}),
    },
    hooks: {
      // Properly merge hook arrays - don't let spread operator overwrite
      beforeChange: [
        createIsHomepageUniqueHook(),
        ...(collectionOverrides.hooks?.beforeChange ?? []),
      ],
      beforeValidate: collectionOverrides.hooks?.beforeValidate,
      beforeDelete: collectionOverrides.hooks?.beforeDelete,
      beforeRead: collectionOverrides.hooks?.beforeRead,
      afterChange: collectionOverrides.hooks?.afterChange,
      afterDelete: collectionOverrides.hooks?.afterDelete,
      afterRead: collectionOverrides.hooks?.afterRead,
      afterOperation: collectionOverrides.hooks?.afterOperation,
      afterForgotPassword: collectionOverrides.hooks?.afterForgotPassword,
      afterLogin: collectionOverrides.hooks?.afterLogin,
      afterLogout: collectionOverrides.hooks?.afterLogout,
      afterRefresh: collectionOverrides.hooks?.afterRefresh,
      afterMe: collectionOverrides.hooks?.afterMe,
    },
    versions:
      typeof collectionOverrides.versions === 'object'
        ? { drafts: true, ...collectionOverrides.versions }
        : { drafts: true },
    fields: baseFields,
    // Everything merged above (admin, access, hooks, versions, fields) must not
    // be clobbered by a shallow spread of the overrides: passing
    // `collectionOverrides: { access: { readVersions } }` used to replace the
    // whole access object and silently hand read/create/update/delete back to
    // Payload's defaults.
    ...restOverrides,
    // Ensure fields aren't overwritten by collectionOverrides
    ...(collectionOverrides.fields && {
      fields: [...baseFields, ...collectionOverrides.fields],
    }),
  }
}

// Note: puckDataField is now exported from '../fields/index.js' for hybrid collection integration
// Re-export for backwards compatibility
export { puckDataField } from '../fields/index.js'
