import { mergeConfig, type UserConfig } from 'vite';

/**
 * Admin panel Vite overrides.
 *
 * Why this file exists
 * --------------------
 * Strapi auto-adds a plugin to `optimizeDeps.exclude` when it is ESM, ships a
 * pre-built `dist`, and has a React peer dependency (see
 * @strapi/strapi/dist/src/node/core/admin-vite-optimize-exclude.js). That is
 * done so shared plugin UI kits resolve through the admin's React/design-system
 * aliases instead of being re-bundled into a second copy.
 *
 * `@_sh/strapi-plugin-ckeditor` matches all three conditions, so it is
 * excluded — and an excluded package has its whole import graph served to the
 * browser as raw ESM, with no pre-bundling. Any CommonJS-only package in that
 * graph then fails to load, because a UMD/CJS file has no ESM exports:
 *
 *   Uncaught SyntaxError: The requested module
 *   '/admin/node_modules/fuzzysort/fuzzysort.js' does not provide an export
 *   named 'default'
 *
 * Strapi's own fix for the same problem on the admin side is to list such
 * packages in `optimizeDeps.include`, which forces Vite to pre-bundle them to
 * ESM with CommonJS interop.
 *
 * The list below is every CJS-only package in the ckeditor dependency graph:
 *
 *   fuzzysort  <- ckeditor5 > @ckeditor/ckeditor5-emoji
 *   extend     <- ckeditor5 > @ckeditor/ckeditor5-markdown-gfm > unified
 *   debug, ms  <- transitive deps of the unified/remark toolchain
 *   lodash     <- ckeditor5
 *
 * Deliberately NOT listed: `react`, `react-dom` and `styled-components`. They
 * are CJS too, but Strapi pins them as admin singletons via resolve aliases.
 * Pre-bundling them here would give the admin a second React instance.
 *
 * If a future ckeditor upgrade surfaces the same error for another package,
 * add its name here. To regenerate the list, walk the plugin's dependency tree
 * and collect packages whose package.json has no `type: "module"` and no
 * `exports["."].import`.
 */
const CKEDITOR_CJS_DEPENDENCIES = ['fuzzysort', 'extend', 'debug', 'ms', 'lodash'];

export default (config: UserConfig) => {
  // Important: always return the modified config
  return mergeConfig(config, {
    optimizeDeps: {
      include: CKEDITOR_CJS_DEPENDENCIES,
    },
  });
};
