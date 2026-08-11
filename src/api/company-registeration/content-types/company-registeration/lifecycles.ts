/**
 * Sends the company notification for every new entry — website submissions
 * and entries created in Strapi Admin alike.
 */

import { notifyOnCreate, type CreateLifecycleEvent } from '../../../../utils/notify-submission';

export default {
  afterCreate(event: CreateLifecycleEvent) {
    notifyOnCreate('company', event);
  },
};
