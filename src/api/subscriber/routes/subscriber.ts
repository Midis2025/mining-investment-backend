/**
 * subscriber router
 *
 * `create` (POST /api/subscribers) is public to allow newsletter subscriptions without login.
 * Other actions (`find`, `findOne`, `update`, `delete`) remain permission-gated.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::subscriber.subscriber', {
  config: {
    create: {
      auth: false,
      policies: [],
      middlewares: [],
    },
  },
});
