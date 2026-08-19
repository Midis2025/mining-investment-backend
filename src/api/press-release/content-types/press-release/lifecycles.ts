/**
 * Press Release Content Type Lifecycles.
 *
 * Automatically triggers Mailchimp campaign dispatch when a press release
 * is newly created/updated into a published state.
 */

import { deliverPressReleaseCampaign } from '../../../../utils/press-release-campaign';

export interface PressReleaseLifecycleEvent {
  result?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export default {
  afterCreate(event: PressReleaseLifecycleEvent) {
    const entry = event.result;
    if (!entry) return;

    // Only dispatch if published and not already sent
    if (entry.publishedAt && entry.mailchimpCampaignStatus !== 'Sent') {
      const documentId = typeof entry.documentId === 'string' ? entry.documentId : '';
      if (documentId) {
        setTimeout(() => {
          void deliverPressReleaseCampaign(documentId, entry);
        }, 1000);
      }
    }
  },

  afterUpdate(event: PressReleaseLifecycleEvent) {
    const entry = event.result;
    if (!entry) return;

    // Only dispatch if published and not already sent or in-progress
    if (
      entry.publishedAt &&
      entry.mailchimpCampaignStatus !== 'Sent' &&
      entry.mailchimpCampaignStatus !== 'Sending'
    ) {
      const documentId = typeof entry.documentId === 'string' ? entry.documentId : '';
      if (documentId) {
        setTimeout(() => {
          void deliverPressReleaseCampaign(documentId, entry);
        }, 1000);
      }
    }
  },
};
