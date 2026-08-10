/**
 * company-registeration router
 *
 * Only `create` (POST /api/company-registrations) is public — the website has
 * to submit it without a login. `find`, `findOne`, `update` and `delete` stay
 * permission-gated so submissions cannot be listed or altered from the web.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter(
  'api::company-registeration.company-registeration',
  {
    config: {
      create: { auth: false, policies: [], middlewares: [] },
    },
  }
);
