/**
 * Press Release -> Mailchimp Campaign Orchestrator.
 *
 * Automatically creates, populates, and sends a Mailchimp regular campaign
 * to the Subscriber Audience (MAILCHIMP_SUBSCRIBER_AUDIENCE_ID) whenever a
 * Press Release is published in Strapi.
 *
 * Implements strict idempotency checks, concurrency locks, and retry support
 * to prevent duplicate campaign broadcasts.
 */

import type { Core } from '@strapi/strapi';
import {
  createMailchimpCampaign,
  getAudienceId,
  getMailchimpAudienceDefaults,
  getMailchimpCampaign,
  MailchimpError,
  sendMailchimpCampaign,
  sendMailchimpTestCampaign,
  setMailchimpCampaignContent,
} from './mailchimp';
import { renderPressReleaseEmailHtml } from './press-release-email';

const PRESS_RELEASE_UID = 'api::press-release.press-release';

/**
 * In-memory concurrency lock to prevent parallel executions for the same document
 */
const activeSends = new Set<string>();

function getStrapi(): Core.Strapi {
  return (global as unknown as { strapi: Core.Strapi }).strapi;
}

/**
 * Resolves absolute URL for media uploads.
 */
function resolveMediaUrl(media: any): string | null {
  if (!media) return null;
  const file = Array.isArray(media) ? media[0] : media;
  if (!file || typeof file !== 'object') return null;

  const url = file.url;
  if (typeof url !== 'string' || !url) return null;
  if (/^https?:\/\//i.test(url)) return url;

  const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return publicUrl ? `${publicUrl}${url}` : url;
}

/**
 * Records campaign outcome and status in the Press Release document.
 */
async function updatePressReleaseStatus(
  strapi: Core.Strapi,
  documentId: string,
  data: Record<string, unknown>
): Promise<void> {
  const updatePayload: Record<string, any> = {};
  if (data.mailchimpCampaignId !== undefined) {
    updatePayload.mailchimp_campaign_id = data.mailchimpCampaignId;
  }
  if (data.mailchimpCampaignStatus !== undefined) {
    updatePayload.mailchimp_campaign_status = data.mailchimpCampaignStatus;
  }
  if (data.mailchimpSentAt !== undefined) {
    updatePayload.mailchimp_sent_at = data.mailchimpSentAt;
  }
  if (data.mailchimpError !== undefined) {
    updatePayload.mailchimp_error = data.mailchimpError;
  }
  updatePayload.updated_at = new Date().toISOString();

  // Try direct Knex connection: avoids transaction collisions and recursive lifecycles
  try {
    const knex = (strapi.db as any)?.connection;
    if (typeof knex === 'function') {
      const updatedCount = await knex('press_releases')
        .where('document_id', documentId)
        .update(updatePayload);
      if (updatedCount > 0) {
        return;
      }
    }
  } catch (rawError) {
    // If raw update fails, fallback to document service / db query
  }

  try {
    await strapi.db.query(PRESS_RELEASE_UID).updateMany({
      where: { documentId },
      data,
    });
  } catch (error) {
    try {
      const documents = strapi.documents(PRESS_RELEASE_UID as Parameters<Core.Strapi['documents']>[0]);
      await (documents as any).update({ documentId, data });
    } catch (fallbackError) {
      strapi.log.error(`[Press Release] Failed to update status for document ${documentId}:`, fallbackError);
    }
  }
}

/**
 * Loads the press release document safely outside of active transaction windows.
 */
async function loadPressReleaseWithRetry(
  strapi: Core.Strapi,
  documentId: string,
  maxRetries = 3
): Promise<Record<string, any> | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Small pause to allow parent publishing transaction to fully commit
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));

      const documents = strapi.documents(PRESS_RELEASE_UID as Parameters<Core.Strapi['documents']>[0]);
      const entry = (await (documents as any).findOne({
        documentId,
        populate: ['pdfFile'],
      })) as Record<string, any> | null;

      if (entry) {
        return entry;
      }
    } catch (err: any) {
      if (attempt === maxRetries) {
        try {
          const dbEntry = await strapi.db.query(PRESS_RELEASE_UID).findOne({
            where: { documentId },
            populate: { pdfFile: true },
          });
          if (dbEntry) return dbEntry as Record<string, any>;
        } catch (dbErr) {
          strapi.log.error(`[Press Release] Could not load document ${documentId}:`, dbErr);
        }
      }
    }
  }
  return null;
}

/**
 * Main dispatch function: checks conditions, compiles campaign, and sends to Mailchimp.
 */
export async function deliverPressReleaseCampaign(
  documentId: string,
  initialData?: Record<string, any>
): Promise<void> {
  if (!documentId) return;

  // Concurrency guard
  if (activeSends.has(documentId)) {
    return;
  }
  activeSends.add(documentId);

  try {
    const strapi = getStrapi();
    if (!strapi) return;

    let entry: Record<string, any> | null = null;

    if (initialData && initialData.title && initialData.publishedAt) {
      entry = initialData;
    }

    if (!entry) {
      entry = await loadPressReleaseWithRetry(strapi, documentId);
    }

    if (!entry) {
      strapi.log.warn(`[Press Release] Document ${documentId} not found.`);
      return;
    }

    // 1. Must be published
    if (!entry.publishedAt) {
      strapi.log.debug?.(`[Press Release] Document ${documentId} is in draft mode. Skipping Mailchimp send.`);
      return;
    }

    // 2. Idempotency check: Do not send if already sent
    if (entry.mailchimpCampaignStatus === 'Sent' || entry.mailchimpSentAt) {
      strapi.log.info(
        `[Press Release] Document ${documentId} ("${entry.title}") has already been sent to Mailchimp on ${entry.mailchimpSentAt}. Skipping.`
      );
      return;
    }

    const title = String(entry.title || '').trim();
    if (!title) {
      strapi.log.warn(`[Press Release] Document ${documentId} has no title. Skipping Mailchimp campaign.`);
      return;
    }

    // 3. Resolve Mailchimp Subscriber Audience ID
    const audienceId = getAudienceId('subscriber');
    if (!audienceId) {
      strapi.log.warn(
        `[Press Release] MAILCHIMP_SUBSCRIBER_AUDIENCE_ID is not configured. Marking status as Failed.`
      );
      await updatePressReleaseStatus(strapi, documentId, {
        mailchimpCampaignStatus: 'Failed',
        mailchimpError: 'MAILCHIMP_SUBSCRIBER_AUDIENCE_ID is not configured.',
      });
      return;
    }

    // 4. Mark status as 'Sending' in database
    await updatePressReleaseStatus(strapi, documentId, {
      mailchimpCampaignStatus: 'Sending',
      mailchimpError: null,
    });

    // 5. Resolve sender settings
    let audienceDefaults: { fromName?: string; fromEmail?: string; subject?: string } | null = null;
    try {
      audienceDefaults = await getMailchimpAudienceDefaults(audienceId);
    } catch {
      // Non-fatal if defaults lookup fails
    }

    const fromName =
      process.env.MAILCHIMP_PRESS_RELEASE_FROM_NAME?.trim() ||
      audienceDefaults?.fromName ||
      'THE Mining Investment Event';

    const replyTo =
      process.env.MAILCHIMP_PRESS_RELEASE_REPLY_TO?.trim() ||
      audienceDefaults?.fromEmail ||
      process.env.INVESTOR_FORM_EMAIL?.trim() ||
      process.env.EMAIL_FROM?.trim() ||
      'jchoi@irinc.ca';

    const campaignSubject = `Mining Investment Event | ${title}`;
    const campaignTitle = `Mining Investment Event - Press Release - ${title}`.slice(0, 100);

    // 6. Build canonical URLs & Render HTML Template
    const websiteUrl =
      process.env.WEBSITE_URL?.trim() ||
      process.env.FRONTEND_URL?.trim() ||
      'https://mining-investment-six.vercel.app';

    const pdfUrl = resolveMediaUrl(entry.pdfFile);
    const pressReleaseUrl = `${websiteUrl.replace(/\/+$/, '')}/newsflash`;

    const html = renderPressReleaseEmailHtml({
      title,
      date: entry.date || entry.publishedAt || entry.createdAt,
      shortDescription: entry.shortDescription,
      longDescription: entry.longDescription,
      pdfUrl,
      pressReleaseUrl,
      websiteUrl,
    });

    // 7. Check if an existing campaign exists and can be reused
    let campaignId: string | null = typeof entry.mailchimpCampaignId === 'string' ? entry.mailchimpCampaignId : null;

    if (campaignId) {
      const existingCampaign = await getMailchimpCampaign(campaignId);
      if (existingCampaign?.status === 'sent') {
        // Already sent on Mailchimp side
        await updatePressReleaseStatus(strapi, documentId, {
          mailchimpCampaignId: campaignId,
          mailchimpCampaignStatus: 'Sent',
          mailchimpSentAt: existingCampaign.send_time || new Date().toISOString(),
          mailchimpError: null,
        });
        strapi.log.info(`[Press Release] Campaign ${campaignId} was already sent in Mailchimp.`);
        return;
      }
    }

    if (!campaignId) {
      // Create new campaign
      const created = await createMailchimpCampaign({
        audienceId,
        subject: campaignSubject,
        title: campaignTitle,
        fromName,
        replyTo,
        previewText: entry.shortDescription ? String(entry.shortDescription).slice(0, 150) : undefined,
      });
      campaignId = created.id;
    }

    // 8. Set campaign HTML content
    await setMailchimpCampaignContent(campaignId, html);

    // 9. Send campaign (or run in Test Mode)
    const isTestMode =
      process.env.MAILCHIMP_PRESS_RELEASE_TEST_MODE === 'true' ||
      process.env.MAILCHIMP_PRESS_RELEASE_TEST_MODE === '1';

    const testEmail = process.env.MAILCHIMP_PRESS_RELEASE_TEST_EMAIL?.trim();

    if (isTestMode) {
      if (testEmail) {
        await sendMailchimpTestCampaign(campaignId, [testEmail]);
        strapi.log.info(
          `[Press Release] TEST MODE: Campaign ${campaignId} sent to test address (${testEmail}).`
        );
      } else {
        strapi.log.info(
          `[Press Release] TEST MODE: Campaign ${campaignId} created and content set. Broadcast skipped because TEST_MODE=true.`
        );
      }
    } else {
      // Live send to Subscriber Audience
      await sendMailchimpCampaign(campaignId);
      strapi.log.info(
        `[Press Release] Successfully broadcast Mailchimp Campaign ${campaignId} to Subscriber Audience (${audienceId}).`
      );
    }

    // 10. Record success in Strapi database
    await updatePressReleaseStatus(strapi, documentId, {
      mailchimpCampaignId: campaignId,
      mailchimpCampaignStatus: 'Sent',
      mailchimpSentAt: new Date().toISOString(),
      mailchimpError: null,
    });
  } catch (error) {
    const message =
      error instanceof MailchimpError || error instanceof Error
        ? error.message
        : 'Unknown error occurred while creating/sending Mailchimp campaign.';

    const strapi = getStrapi();
    if (strapi) {
      strapi.log.error(`[Press Release] Failed to send Mailchimp campaign for ${documentId}:`, error);
      await updatePressReleaseStatus(strapi, documentId, {
        mailchimpCampaignStatus: 'Failed',
        mailchimpError: message.slice(0, 1000),
      });
    }
  } finally {
    activeSends.delete(documentId);
  }
}
