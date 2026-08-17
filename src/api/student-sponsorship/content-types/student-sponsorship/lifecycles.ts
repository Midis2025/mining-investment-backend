/**
 * Sends the student sponsorship notification via Resend and synchronizes with
 * Mailchimp Student Audience for every new entry — website submissions
 * and entries created in Strapi Admin alike.
 */

import { notifyOnCreate, type CreateLifecycleEvent } from '../../../../utils/notify-submission';
import { syncMailchimpOnCreate } from '../../../../utils/sync-mailchimp';

export default {
  afterCreate(event: CreateLifecycleEvent) {
    notifyOnCreate('studentSponsorship', event);
    syncMailchimpOnCreate('studentSponsorship', event);
  },
};

