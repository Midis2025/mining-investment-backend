/**
 * Sends the investor notification via Resend and synchronizes with
 * Mailchimp Investor Audience for every new entry — website submissions
 * and entries created in Strapi Admin alike.
 */

import { notifyOnCreate, type CreateLifecycleEvent } from '../../../../utils/notify-submission';
import { syncMailchimpOnCreate } from '../../../../utils/sync-mailchimp';

export default {
  afterCreate(event: CreateLifecycleEvent) {
    notifyOnCreate('investor', event);
    syncMailchimpOnCreate('investor', event);
  },
};

