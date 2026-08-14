/**
 * Custom public routes for newsletter subscription.
 * Exposes POST /api/newsletter-subscribe and POST /api/subscribers/subscribe.
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/newsletter-subscribe',
      handler: 'subscriber.subscribe',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/subscribers/subscribe',
      handler: 'subscriber.subscribe',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
