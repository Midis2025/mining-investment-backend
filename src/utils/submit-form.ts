/**
 * Shared submission handler for the public website forms.
 *
 * Order of operations matters here: the submission is persisted *before* the
 * notification is attempted, and a failed notification is recorded on the entry
 * rather than propagated to the caller. A submission is never lost because
 * Resend is down or misconfigured.
 */

import type { Core } from '@strapi/strapi';

import {
  FORM_DEFINITIONS,
  getMediaFields,
  type FormType,
} from './form-definitions';
import { unwrapBody, validateSubmission, type FieldError } from './form-validation';
import { EmailDeliveryError, sendFormSubmissionEmail, type MediaSummary } from './email';

/** Structural subset of the Koa context this handler touches. */
export interface SubmissionContext {
  request: { body?: unknown };
  status: number;
  body: unknown;
  ip?: string;
}

export interface SubmitFormInput {
  strapi: Core.Strapi;
  ctx: SubmissionContext;
  formType: FormType;
}

interface SuccessPayload {
  success: true;
  message: string;
  data: {
    id: number;
    documentId: string;
    registrationNumber: string;
    email?: string;
  };
}

/**
 * Short-lived record of recent submissions, used to absorb double submits
 * (double-clicked button, retried request) without creating duplicate rows.
 * In-memory and therefore per-instance — it is a UX guard, not a rate limiter.
 */
const recentSubmissions = new Map<string, { at: number; payload: SuccessPayload }>();

function getDuplicateWindowMs(): number {
  const raw = Number(process.env.FORM_DUPLICATE_WINDOW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

function pruneRecentSubmissions(now: number, windowMs: number): void {
  for (const [key, entry] of recentSubmissions) {
    if (now - entry.at > windowMs) recentSubmissions.delete(key);
  }
}

function buildReference(prefix: string, id: number, createdAt: Date): string {
  return `${prefix}-${createdAt.getUTCFullYear()}-${String(id).padStart(5, '0')}`;
}

function respondWithValidationErrors(ctx: SubmissionContext, errors: FieldError[]): void {
  ctx.status = 400;
  ctx.body = {
    success: false,
    message: errors[0]?.message ?? 'The submission could not be validated.',
    errors,
  };
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

/** Local uploads are stored as root-relative paths; emails need absolute ones. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}${url}` : url;
}

export async function submitForm({ strapi, ctx, formType }: SubmitFormInput): Promise<unknown> {
  const definition = FORM_DEFINITIONS[formType];

  const body = unwrapBody(ctx.request.body);
  if (!body) {
    respondWithValidationErrors(ctx, [{ field: '', message: 'A submission body is required.' }]);
    return ctx.body;
  }

  const { data, errors } = validateSubmission(definition, body);
  if (errors.length > 0) {
    respondWithValidationErrors(ctx, errors);
    return ctx.body;
  }

  // --- Duplicate guard -----------------------------------------------------
  const windowMs = getDuplicateWindowMs();
  const dedupeKey = definition.replyToField
    ? `${formType}:${String(data[definition.replyToField] ?? '')}`
    : '';
  const now = Date.now();
  pruneRecentSubmissions(now, windowMs);

  if (windowMs > 0 && dedupeKey) {
    const previous = recentSubmissions.get(dedupeKey);
    if (previous && now - previous.at <= windowMs) {
      strapi.log.info(`[${formType}] duplicate submission suppressed for ${dedupeKey}`);
      ctx.status = 200;
      ctx.body = previous.payload;
      return ctx.body;
    }
  }

  // --- Persist -------------------------------------------------------------
  const mediaFieldNames = getMediaFields(definition).map((field) => field.name);

  let entry: Record<string, unknown>;
  try {
    // The UID is a runtime value from the registry, so the per-UID generic
    // typings cannot be resolved statically here.
    const documents = strapi.documents(definition.uid as Parameters<Core.Strapi['documents']>[0]);
    entry = (await (documents as any).create({
      data: { ...data, emailStatus: 'pending' },
      ...(mediaFieldNames.length > 0 ? { populate: mediaFieldNames } : {}),
    })) as Record<string, unknown>;
  } catch (error) {
    strapi.log.error(`[${formType}] failed to store submission`, error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message: 'We could not save your submission. Please try again shortly.',
    };
    return ctx.body;
  }

  const id = Number(entry.id);
  const documentId = String(entry.documentId ?? '');
  const submittedAt = new Date();
  const reference = buildReference(definition.referencePrefix, id, submittedAt);

  const payload: SuccessPayload = {
    success: true,
    message: definition.successMessage,
    data: {
      id,
      documentId,
      registrationNumber: reference,
      ...(definition.replyToField && typeof data[definition.replyToField] === 'string'
        ? { email: data[definition.replyToField] as string }
        : {}),
    },
  };

  if (dedupeKey) recentSubmissions.set(dedupeKey, { at: now, payload });

  // --- Notify --------------------------------------------------------------
  // Failures past this point are logged and recorded, never surfaced: the
  // submission is already safely stored.
  try {
    const result = await sendFormSubmissionEmail({
      formType,
      formData: data,
      reference,
      media: collectMediaSummaries(entry, mediaFieldNames),
      submittedAt,
    });

    await updateEmailStatus(strapi, definition.uid, documentId, {
      emailStatus: 'sent',
      emailSentAt: submittedAt.toISOString(),
      emailError: null,
    });

    strapi.log.info(`[${formType}] notification sent to ${result.to} (${reference})`);
  } catch (error) {
    const message =
      error instanceof EmailDeliveryError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown email error.';

    strapi.log.error(`[${formType}] notification failed for ${reference}: ${message}`);

    await updateEmailStatus(strapi, definition.uid, documentId, {
      emailStatus: 'failed',
      emailError: message.slice(0, 1000),
    });
  }

  ctx.status = 201;
  ctx.body = payload;
  return ctx.body;
}

/** Best-effort status write; a failure here must not affect the API response. */
async function updateEmailStatus(
  strapi: Core.Strapi,
  uid: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!documentId) return;
  try {
    const documents = strapi.documents(uid as Parameters<Core.Strapi['documents']>[0]);
    await (documents as any).update({ documentId, data });
  } catch (error) {
    strapi.log.error(`Failed to record email status on ${uid} ${documentId}`, error);
  }
}
