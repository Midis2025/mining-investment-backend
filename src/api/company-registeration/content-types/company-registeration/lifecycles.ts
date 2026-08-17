/**
 * Sends the company notification via Resend and synchronizes with
 * Mailchimp Company Audience for every new entry — website submissions
 * and entries created in Strapi Admin alike.
 */

import { notifyOnCreate, type CreateLifecycleEvent } from '../../../../utils/notify-submission';
import { syncMailchimpOnCreate } from '../../../../utils/sync-mailchimp';

export default {
  afterCreate(event: CreateLifecycleEvent) {
    notifyOnCreate('company', event);
    syncMailchimpOnCreate('company', event);
  },
};

