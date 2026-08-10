/**
 * student-sponsorship controller
 *
 * `create` is overridden to run the shared public-form pipeline: validate,
 * store, then notify STUDENT_SPONSORSHIP_EMAIL via Resend. Every other core
 * action is left untouched and stays permission-gated.
 */

import { factories } from '@strapi/strapi';

import { submitForm } from '../../../utils/submit-form';

export default factories.createCoreController(
  'api::student-sponsorship.student-sponsorship',
  ({ strapi }) => ({
    async create(ctx) {
      return submitForm({ strapi, ctx, formType: 'studentSponsorship' });
    },
  })
);
