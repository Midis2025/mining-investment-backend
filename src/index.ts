import type { Core } from '@strapi/strapi';

import { FORM_DEFINITIONS, type FormType } from './utils/form-definitions';
import { getMissingEmailConfig } from './utils/email';

/**
 * Submissions are created through routes marked `auth: false`, so the Public
 * role needs no permission at all on these content types. Any permission it
 * does hold is a way to read, edit or delete other people's submissions, so
 * they are stripped on every boot.
 *
 * Set LOCK_FORM_PUBLIC_PERMISSIONS=false to opt out.
 */
async function lockDownFormPermissions(strapi: Core.Strapi): Promise<void> {
  if (process.env.LOCK_FORM_PUBLIC_PERMISSIONS === 'false') return;

  for (const definition of Object.values(FORM_DEFINITIONS)) {
    try {
      const stale = await strapi.db
        .query('plugin::users-permissions.permission')
        .findMany({
          where: {
            role: { type: 'public' },
            action: { $startsWith: `${definition.uid}.` },
          },
        });

      if (stale.length === 0) continue;

      await strapi.db.query('plugin::users-permissions.permission').deleteMany({
        where: { id: { $in: stale.map((permission: { id: number }) => permission.id) } },
      });

      strapi.log.warn(
        `Revoked ${stale.length} Public role permission(s) on ${definition.uid}: ` +
          `${stale.map((p: { action: string }) => p.action.split('.').pop()).join(', ')}. ` +
          'Public submissions go through the auth-less create route instead.'
      );
    } catch (error) {
      strapi.log.error(`Could not audit Public permissions for ${definition.uid}`, error);
    }
  }
}

/** Fails loudly at boot rather than silently at the first submission. */
function warnAboutEmailConfig(strapi: Core.Strapi): void {
  for (const formType of Object.keys(FORM_DEFINITIONS) as FormType[]) {
    const missing = getMissingEmailConfig(formType);
    if (missing.length > 0) {
      strapi.log.warn(
        `Form "${formType}" cannot send notifications — missing env: ${missing.join(', ')}. ` +
          'Submissions will still be stored and flagged emailStatus="failed".'
      );
    }
  }
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await lockDownFormPermissions(strapi);
    warnAboutEmailConfig(strapi);
  },
};
