/**
 * Shared submission handler for the public website forms.
 *
 * This validates and stores the submission, and nothing more. The notification
 * is sent from the content type's `afterCreate` lifecycle (see
 * ./notify-submission), so website submissions and entries created in Strapi
 * Admin behave identically — and a submission is never lost because Resend is
 * down or misconfigured.
 */

import type { Core } from '@strapi/strapi';

import { FORM_DEFINITIONS, buildReference, getMediaFields, type FormType } from './form-definitions';
import { unwrapBody, validateSubmission, type FieldError } from './form-validation';

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

function respondWithValidationErrors(ctx: SubmissionContext, errors: FieldError[]): void {
  ctx.status = 400;
  ctx.body = {
    success: false,
    message: errors[0]?.message ?? 'The submission could not be validated.',
    errors,
  };
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
  const createdAt = entry.createdAt ? new Date(String(entry.createdAt)) : new Date();
  const reference = buildReference(definition, id, createdAt);

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

  // The notification is dispatched by the content type's afterCreate lifecycle,
  // which has already been triggered by the create above. Nothing to do here.
  ctx.status = 201;
  ctx.body = payload;
  return ctx.body;
}
