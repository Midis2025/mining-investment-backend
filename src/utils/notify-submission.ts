/**
 * Notification dispatch for form submissions.
 *
 * This is driven by the content-type `afterCreate` lifecycle rather than the
 * controller, so an entry created in Strapi Admin sends exactly the same email
 * as one submitted from the website — one code path, no double sends.
 *
 * Delivery is deferred to the next tick so it runs after the create has
 * committed: the notification never holds up the API response, and a slow or
 * failing Resend call can never roll back a stored submission.
 */

import type { Core } from '@strapi/strapi';

import {
  FORM_DEFINITIONS,
  buildReference,
  getMediaFields,
  pickFormData,
  type FormType,
} from './form-definitions';
import { EmailDeliveryError, sendFormSubmissionEmail, type MediaSummary } from './email';

/** The subset of a Strapi lifecycle event this module reads. */
export interface CreateLifecycleEvent {
  result?: Record<string, unknown>;
}

function getStrapi(): Core.Strapi {
  return (global as unknown as { strapi: Core.Strapi }).strapi;
}

/** Local uploads are stored as root-relative paths; emails need absolute ones. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}${url}` : url;
}

/**
 * Turns populated media relations into the name/url pairs the email renders.
 * Never throws — a missing file just omits the row.
 */
function collectMediaSummaries(
  entry: Record<string, unknown>,
  fieldNames: string[]
): Record<string, MediaSummary | undefined> {
  const summaries: Record<string, MediaSummary | undefined> = {};

  for (const name of fieldNames) {
    const value = entry[name];
    const file = Array.isArray(value) ? value[0] : value;
    if (file && typeof file === 'object') {
      const record = file as Record<string, unknown>;
      const fileName = typeof record.name === 'string' ? record.name : null;
      if (fileName) {
        summaries[name] = {
          name: fileName,
          url: typeof record.url === 'string' ? absoluteUrl(record.url) : undefined,
        };
      }
    }
  }

  return summaries;
}

/**
 * Hook for a content type's `afterCreate` lifecycle. Fires for website
 * submissions and Strapi Admin entries alike.
 */
export function notifyOnCreate(formType: FormType, event: CreateLifecycleEvent): void {
  const entry = event.result;
  if (!entry) return;

  const documentId = typeof entry.documentId === 'string' ? entry.documentId : '';
  if (!documentId) return;

  // Lets an admin (or a data import) opt out by setting the status up front.
  if (entry.emailStatus === 'sent') return;

  setImmediate(() => {
    void deliverNotification(formType, documentId);
  });
}

/**
 * Re-reads the committed entry (so media relations are populated), sends the
 * notification, and records the outcome on the entry itself.
 */
export async function deliverNotification(
  formType: FormType,
  documentId: string
): Promise<void> {
  const strapi = getStrapi();
  if (!strapi) return;

  const definition = FORM_DEFINITIONS[formType];
  const mediaFieldNames = getMediaFields(definition).map((field) => field.name);

  let entry: Record<string, unknown> | null = null;

  try {
    // The UID is a runtime value from the registry, so the per-UID generic
    // typings cannot be resolved statically here.
    const documents = strapi.documents(definition.uid as Parameters<Core.Strapi['documents']>[0]);
    entry = (await (documents as any).findOne({
      documentId,
      ...(mediaFieldNames.length > 0 ? { populate: mediaFieldNames } : {}),
    })) as Record<string, unknown> | null;
  } catch (error) {
    strapi.log.error(`[${formType}] could not load ${documentId} for notification`, error);
    return;
  }

  if (!entry) return;
  if (entry.emailStatus === 'sent') return;

  const createdAt = entry.createdAt ? new Date(String(entry.createdAt)) : new Date();
  const reference = buildReference(definition, Number(entry.id), createdAt);

  try {
    const result = await sendFormSubmissionEmail({
      formType,
      formData: pickFormData(definition, entry),
      reference,
      media: collectMediaSummaries(entry, mediaFieldNames),
      submittedAt: createdAt,
    });

    await recordEmailStatus(strapi, definition.uid, documentId, {
      emailStatus: 'sent',
      emailSentAt: new Date().toISOString(),
      emailError: null,
    });

    strapi.log.info(`[${formType}] notification sent to ${result.to} (${reference})`);
  } catch (error) {
    const message =
      error instanceof EmailDeliveryError || error instanceof Error
        ? error.message
        : 'Unknown email error.';

    strapi.log.error(`[${formType}] notification failed for ${reference}: ${message}`);

    await recordEmailStatus(strapi, definition.uid, documentId, {
      emailStatus: 'failed',
      emailError: message.slice(0, 1000),
    });
  }
}

/**
 * Best-effort status write. Guarded because this runs inside an `afterUpdate`
 * -triggering call — a failure here must never escape into the request.
 */
async function recordEmailStatus(
  strapi: Core.Strapi,
  uid: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const documents = strapi.documents(uid as Parameters<Core.Strapi['documents']>[0]);
    await (documents as any).update({ documentId, data });
  } catch (error) {
    strapi.log.error(`Failed to record email status on ${uid} ${documentId}`, error);
  }
}
