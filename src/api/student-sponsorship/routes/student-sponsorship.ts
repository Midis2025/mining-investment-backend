/**
 * student-sponsorship router
 *
 * Only `create` (POST /api/student-sponsorships) is public — the website has
 * to submit it without a login. `find`, `findOne`, `update` and `delete` stay
 * permission-gated so submissions cannot be listed or altered from the web.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::student-sponsorship.student-sponsorship', {
  config: {
    create: { auth: false, policies: [], middlewares: [] },
  },
});
