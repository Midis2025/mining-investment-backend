/**
 * Reusable Resend notification service.
 *
 * All credentials and recipient addresses are resolved from the environment on
 * the server. Nothing here is derived from the request body, so the frontend
 * can never influence who a submission is sent to.
 */

import { Resend } from 'resend';

import {
  FORM_DEFINITIONS,
  type FieldDefinition,
  type FormDefinition,
  type FormType,
} from './form-definitions';
import { isValidEmail } from './form-validation';

/** Thrown for every failure path so callers never see raw SDK/network errors. */
export class EmailDeliveryError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.cause = cause;
  }
}

export interface MediaSummary {
  name: string;
  url?: string;
}

export interface SendFormSubmissionEmailInput {
  formType: FormType;
  /** Validated, normalised submission values. */
  formData: Record<string, unknown>;
  /**
   * Optional recipient override. Internal use only — never pass a value that
   * originated from a request body.
   */
  recipient?: string;
  /** Human readable reference shown in the email, e.g. "INV-2026-00001". */
  reference?: string;
  /** Resolved file details for media fields, keyed by attribute name. */
  media?: Record<string, MediaSummary | undefined>;
  /** Overrides the submission timestamp; defaults to now. */
  submittedAt?: Date;
}

export interface SendFormSubmissionEmailResult {
  id: string | null;
  to: string;
  subject: string;
}

let cachedClient: Resend | null = null;
let cachedApiKey: string | null = null;

function getResendClient(apiKey: string): Resend {
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new Resend(apiKey);
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    // The name is safe to surface in logs; the value never is.
    throw new EmailDeliveryError(`Missing required environment variable ${name}.`);
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: process.env.EMAIL_TIMEZONE?.trim() || 'America/Toronto',
  }).format(date);
}

interface DisplayRow {
  label: string;
  value: string;
  /** Rendered as a block rather than a single line. */
  multiline: boolean;
  href?: string;
}

/** Builds the rows shown in the email, in the order the fields are declared. */
function buildRows(
  definition: FormDefinition,
  formData: Record<string, unknown>,
  media: Record<string, MediaSummary | undefined>
): DisplayRow[] {
  const rows: DisplayRow[] = [];

  for (const field of definition.fields) {
    const row = buildRow(field, formData[field.name], media[field.name]);
    if (row) rows.push(row);
  }

  return rows;
}

function buildRow(
  field: FieldDefinition,
  raw: unknown,
  mediaSummary: MediaSummary | undefined
): DisplayRow | null {
  if (field.kind === 'media') {
    if (!mediaSummary) return null;
    return {
      label: field.label,
      value: mediaSummary.name,
      multiline: false,
      href: mediaSummary.url,
    };
  }

  if (field.kind === 'boolean') {
    if (typeof raw !== 'boolean') return null;
    return { label: field.label, value: raw ? 'Yes' : 'No', multiline: false };
  }

  if (raw === undefined || raw === null || raw === '') return null;

  const value = String(raw);
  return {
    label: field.label,
    value,
    multiline: field.kind === 'text' || value.includes('\n'),
    href: field.kind === 'email' ? `mailto:${value}` : undefined,
  };
}

function renderHtml(
  definition: FormDefinition,
  rows: DisplayRow[],
  submittedAt: Date,
  reference?: string
): string {
  const rowsHtml = rows
    .map((row) => {
      const escaped = escapeHtml(row.value);
      const body = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:#C6112F;text-decoration:none;">${escaped}</a>`
        : row.multiline
          ? escaped.replace(/\r?\n/g, '<br />')
          : escaped;

      return `
        <tr>
          <td style="padding:14px 0 0 0;border-top:1px solid #ececec;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98;margin-bottom:4px;">${escapeHtml(
              row.label
            )}</div>
            <div style="font-size:15px;line-height:1.55;color:#15181f;padding-bottom:14px;${
              row.multiline ? 'white-space:normal;' : ''
            }">${body}</div>
          </td>
        </tr>`;
    })
    .join('');

  const referenceHtml = reference
    ? `<div style="font-size:12px;color:#8a8f98;margin-top:6px;">Reference: <strong style="color:#15181f;">${escapeHtml(
        reference
      )}</strong></div>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ec;">
      <tr>
        <td style="background:#0f1117;padding:24px 28px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C6112F;">Website Submission</div>
          <div style="font-size:21px;font-weight:700;color:#ffffff;margin-top:6px;">${escapeHtml(
            definition.title
          )}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rowsHtml}
            <tr>
              <td style="padding:14px 0 0 0;border-top:1px solid #ececec;">
                <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a8f98;margin-bottom:4px;">Submitted</div>
                <div style="font-size:15px;line-height:1.55;color:#15181f;">${escapeHtml(
                  formatDate(submittedAt)
                )}</div>
                ${referenceHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 24px 28px;">
          <div style="font-size:12px;color:#8a8f98;line-height:1.6;border-top:1px solid #ececec;padding-top:16px;">
            This notification was generated automatically from the website. Reply directly to this email to reach the submitter.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(
  definition: FormDefinition,
  rows: DisplayRow[],
  submittedAt: Date,
  reference?: string
): string {
  const lines = [definition.title, '='.repeat(definition.title.length), ''];

  for (const row of rows) {
    lines.push(`${row.label}:`, row.value, '');
  }

  lines.push('Submitted:', formatDate(submittedAt));
  if (reference) lines.push('', `Reference: ${reference}`);

  return lines.join('\n');
}

/**
 * Sends the notification for a single form submission.
 *
 * Throws {@link EmailDeliveryError} on any failure — missing configuration,
 * transport error, or a non-2xx response from Resend. Callers are expected to
 * catch this: a failed notification must never roll back a stored submission.
 */
export async function sendFormSubmissionEmail(
  input: SendFormSubmissionEmailInput
): Promise<SendFormSubmissionEmailResult> {
  const definition = FORM_DEFINITIONS[input.formType];
  if (!definition) {
    throw new EmailDeliveryError(`Unknown form type "${input.formType}".`);
  }

  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('EMAIL_FROM');
  const recipient = input.recipient?.trim() || requireEnv(definition.recipientEnvVar);

  const submittedAt = input.submittedAt ?? new Date();
  const rows = buildRows(definition, input.formData, input.media ?? {});

  // Reply-To is only set when the submitted address actually validates.
  const replyToCandidate = definition.replyToField
    ? input.formData[definition.replyToField]
    : undefined;
  const replyTo = isValidEmail(replyToCandidate) ? String(replyToCandidate).trim() : undefined;

  let response: Awaited<ReturnType<Resend['emails']['send']>>;
  try {
    response = await getResendClient(apiKey).emails.send({
      from,
      to: recipient,
      subject: definition.subject,
      html: renderHtml(definition, rows, submittedAt, input.reference),
      text: renderText(definition, rows, submittedAt, input.reference),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (error) {
    throw new EmailDeliveryError('Resend request failed.', error);
  }

  if (response.error) {
    throw new EmailDeliveryError(
      `Resend rejected the message: ${response.error.message}`,
      response.error
    );
  }

  return {
    id: response.data?.id ?? null,
    to: recipient,
    subject: definition.subject,
  };
}

/**
 * Reports which env vars a form still needs before it can send. Used at
 * bootstrap to surface misconfiguration early instead of at first submission.
 */
export function getMissingEmailConfig(formType: FormType): string[] {
  const definition = FORM_DEFINITIONS[formType];
  return ['RESEND_API_KEY', 'EMAIL_FROM', definition.recipientEnvVar].filter(
    (name) => !process.env[name]?.trim()
  );
}
