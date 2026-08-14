/**
 * Subscriber controller
 *
 * Handles newsletter subscription submissions:
 * 1. Validates and normalises subscriber email and names
 * 2. Persists subscriber in Strapi database
 * 3. Synchronizes subscriber with Mailchimp Audience
 * 4. Isolates all Mailchimp operations from existing Resend transactional emails
 */

import { factories } from '@strapi/strapi';
import { isValidEmail, unwrapBody } from '../../../utils/form-validation';
import { addOrUpdateSubscriber, MailchimpError } from '../../../utils/mailchimp';

interface SubscribePayload {
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  tags?: string[];
}

function parseNames(body: SubscribePayload): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  let firstName = (body.firstName || '').trim();
  let lastName = (body.lastName || '').trim();
  let fullName = (body.fullName || body.name || '').trim();

  if (!fullName && (firstName || lastName)) {
    fullName = [firstName, lastName].filter(Boolean).join(' ');
  } else if (fullName && !firstName && !lastName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  return { firstName, lastName, fullName };
}

export default factories.createCoreController('api::subscriber.subscriber', ({ strapi }) => ({
  /**
   * Main subscriber handler used by POST /api/newsletter-subscribe and POST /api/subscribers
   */
  async subscribe(ctx) {
    const rawBody = unwrapBody(ctx.request.body) as SubscribePayload | null;
    if (!rawBody || typeof rawBody !== 'object') {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: 'A request body is required.',
      };
      return ctx.body;
    }

    const rawEmail = rawBody.email;
    if (!rawEmail || !isValidEmail(rawEmail)) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: 'Please provide a valid email address.',
      };
      return ctx.body;
    }

    const email = String(rawEmail).trim().toLowerCase();
    const { firstName, lastName, fullName } = parseNames(rawBody);

    let documentId: string | null = null;
    let existingEntry: any = null;

    try {
      const documents = strapi.documents('api::subscriber.subscriber' as any);
      existingEntry = await documents.findFirst({
        filters: { email: { $eq: email } },
      });

      if (existingEntry && existingEntry.documentId) {
        documentId = String(existingEntry.documentId);
        await documents.update({
          documentId,
          data: {
            firstName: firstName || existingEntry.firstName,
            lastName: lastName || existingEntry.lastName,
            fullName: fullName || existingEntry.fullName,
            status: 'Pending',
          },
        });
      } else {
        const created = await documents.create({
          data: {
            email,
            firstName,
            lastName,
            fullName,
            status: 'Pending',
          },
        });
        documentId = String(created.documentId);
      }
    } catch (dbError) {
      strapi.log.error('[Subscriber] Database persistence error:', dbError);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: 'Unable to subscribe at this time. Please try again.',
      };
      return ctx.body;
    }

    // Synchronize to Mailchimp
    try {
      const mailchimpResult = await addOrUpdateSubscriber({
        email,
        firstName,
        lastName,
        tags: Array.isArray(rawBody.tags) ? rawBody.tags : undefined,
      });

      if (documentId) {
        const documents = strapi.documents('api::subscriber.subscriber' as any);
        await documents.update({
          documentId,
          data: {
            status: 'Subscribed',
            mailchimpStatus: mailchimpResult.status,
            mailchimpMemberId: mailchimpResult.id,
            subscribedAt: new Date().toISOString(),
            mailchimpError: null,
          },
        });
      }

      strapi.log.info(`[Subscriber] Successfully subscribed ${email} to Mailchimp (${mailchimpResult.status})`);

      ctx.status = 200;
      ctx.body = {
        success: true,
        message: 'You have successfully subscribed.',
      };
      return ctx.body;
    } catch (error) {
      const errorMessage =
        error instanceof MailchimpError || error instanceof Error
          ? error.message
          : 'Unknown Mailchimp error';

      strapi.log.error(`[Subscriber] Mailchimp synchronization failed for ${email}:`, error);

      if (documentId) {
        try {
          const documents = strapi.documents('api::subscriber.subscriber' as any);
          await documents.update({
            documentId,
            data: {
              status: 'Failed',
              mailchimpStatus: 'failed',
              mailchimpError: errorMessage.slice(0, 1000),
            },
          });
        } catch (updateError) {
          strapi.log.error('[Subscriber] Failed to record error status in Strapi:', updateError);
        }
      }

      ctx.status = 500;
      ctx.body = {
        success: false,
        message: 'Unable to subscribe at this time. Please try again.',
      };
      return ctx.body;
    }
  },

  /**
   * Overriding default create to route through the unified subscribe pipeline
   */
  async create(ctx, next) {
    return (this as any).subscribe(ctx, next);
  },
}));
