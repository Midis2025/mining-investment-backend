/**
 * Reusable Resend notification service.
 *
 * All credentials and recipient addresses are resolved from the environment on
 * the server. Nothing here is derived from the request body, so the frontend
 * can never influence who a submission is sent to.
 */

import fs from 'fs';
import path from 'path';
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
    // Routing-only metadata (e.g. sourceWebsite) is stored but never shown:
    // the notification email keeps rendering exactly the fields the form asks for.
    if (field.excludeFromEmail) continue;
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

const TEMPLATE_CACHE: Partial<Record<FormType, string>> = {};

function getTemplateRaw(formType: FormType): string | null {
  if (TEMPLATE_CACHE[formType]) {
    return TEMPLATE_CACHE[formType]!;
  }

  const filenameMap: Record<FormType, string> = {
    studentSponsorship: 'Sudent-Sponsorship-from-template.html',
    company: 'company-registeration-form.html',
    investor: 'investor-registeration-form.html',
  };

  const filename = filenameMap[formType];
  if (!filename) return null;

  const candidateDirs = [
    path.resolve(process.cwd(), 'src/mining-investment-forms template'),
    path.resolve(__dirname, '../../mining-investment-forms template'),
    path.resolve(__dirname, '../mining-investment-forms template'),
    path.resolve(__dirname, 'mining-investment-forms template'),
    path.resolve(process.cwd(), 'dist/src/mining-investment-forms template'),
  ];

  for (const dir of candidateDirs) {
    const fullPath = path.join(dir, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        TEMPLATE_CACHE[formType] = content;
        return content;
      } catch (err) {
        // Fallback to next candidate
      }
    }
  }

  return null;
}

function renderStudentSponsorshipTemplate(
  templateHtml: string,
  formData: Record<string, unknown>,
  media: Record<string, MediaSummary | undefined>,
  submittedAt: Date,
  reference?: string
): string {
  const firstName = String(formData.firstName || '').trim();
  const lastName = String(formData.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'N/A';
  const email = String(formData.email || '').trim();
  const emailHtml = email
    ? `<a href="mailto:${escapeHtml(email)}" style="color:#A81B32;text-decoration:none;font-weight:500;">${escapeHtml(email)}</a>`
    : 'N/A';
  const phone = String(formData.phone || '').trim() || 'N/A';
  const institution =
    String(formData.schoolInstitution || formData.school || formData.institution || '').trim() || 'N/A';
  const programYear =
    String(formData.programYearOfStudy || formData.program || '').trim() || 'N/A';
  const language = String(formData.preferredLanguage || '').trim() || 'N/A';

  const resume = media.resumeCv || media.resume || media.cv;
  const resumeHtml = resume?.url
    ? `<a href="${escapeHtml(resume.url)}" target="_blank" style="color:#A81B32;text-decoration:underline;font-weight:600;">${escapeHtml(resume.name)} (Download)</a>`
    : resume?.name
      ? escapeHtml(resume.name)
      : '<span style="color:#A0AEC0;">None attached</span>';

  const transcript = media.transcript;
  const transcriptHtml = transcript?.url
    ? `<a href="${escapeHtml(transcript.url)}" target="_blank" style="color:#A81B32;text-decoration:underline;font-weight:600;">${escapeHtml(transcript.name)} (Download)</a>`
    : transcript?.name
      ? escapeHtml(transcript.name)
      : '<span style="color:#A0AEC0;">None attached</span>';

  const letter = String(formData.letterOfInterest || '').trim();
  const letterHtml = letter
    ? escapeHtml(letter).replace(/\r?\n/g, '<br />')
    : '<span style="color:#A0AEC0;">None provided</span>';

  let html = templateHtml;

  html = html.replace(/\{\{Student Name\}\}/g, escapeHtml(fullName));
  html = html.replace(/\{\{Email\}\}/g, emailHtml);
  html = html.replace(/\{\{Phone Number\}\}/g, escapeHtml(phone));
  html = html.replace(/\{\{Institution Name\}\}/g, escapeHtml(institution));
  html = html.replace(/\{\{Program Name\}\}/g, escapeHtml(programYear));
  html = html.replace(/\{\{Year of Study\}\}/g, escapeHtml(programYear));
  html = html.replace(/\{\{Preferred Language\}\}/g, escapeHtml(language));
  html = html.replace(/\{\{Resume File\}\}/g, resumeHtml);
  html = html.replace(/\{\{Letter of Interest\}\}/g, letterHtml);

  // Additional rows for transcript and newsletter
  const additionalRows: string[] = [];

  if (transcript?.name || transcript?.url) {
    additionalRows.push(`
                <!-- Transcript Attachment -->
                <tr>
                  <td width="145" style="width: 145px; background-color: #FFFFFF; border: 1.2px solid #E8A8B2; border-radius: 7px; padding: 10px 14px; font-size: 13px; font-weight: 700; color: #1A202C; vertical-align: middle;">
                    Transcript
                  </td>
                  <td width="7" style="width: 7px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                  <td style="background-color: #FFFFFF; border: 1.2px solid #E8A8B2; border-radius: 7px; padding: 10px 14px; font-size: 13px; color: #2D3748; vertical-align: middle; word-break: break-word;">
                    ${transcriptHtml}
                  </td>
                </tr>`);
  }

  if (formData.newsletterOptIn !== undefined) {
    const optInText = formData.newsletterOptIn ? 'Yes' : 'No';
    additionalRows.push(`
                <!-- Newsletter Opt-in -->
                <tr>
                  <td width="145" style="width: 145px; background-color: #FFFFFF; border: 1.2px solid #E8A8B2; border-radius: 7px; padding: 10px 14px; font-size: 13px; font-weight: 700; color: #1A202C; vertical-align: middle;">
                    Updates Opt-in
                  </td>
                  <td width="7" style="width: 7px; font-size: 1px; line-height: 1px;">&nbsp;</td>
                  <td style="background-color: #FFFFFF; border: 1.2px solid #E8A8B2; border-radius: 7px; padding: 10px 14px; font-size: 13px; color: #2D3748; vertical-align: middle; word-break: break-word;">
                    ${optInText}
                  </td>
                </tr>`);
  }

  html = html.replace(/\{\{Additional Rows\}\}/g, additionalRows.join('\n'));

  // Inject Reference and Submitted date into Status block
  const statusMeta = `
              <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #E8A8B2; font-family: 'Inter', Helvetica, Arial, sans-serif; font-size: 12px; color: #718096;">
                ${reference ? `<div>Submission Reference: <strong style="color: #1E2229;">${escapeHtml(reference)}</strong></div>` : ''}
                <div style="margin-top: 4px;">Submitted At: <strong style="color: #1E2229;">${escapeHtml(formatDate(submittedAt))}</strong></div>
              </div>`;

  html = html.replace(/\{\{Status Meta\}\}/g, statusMeta);

  return html;
}

function renderCompanyTemplate(
  templateHtml: string,
  formData: Record<string, unknown>,
  submittedAt: Date,
  reference?: string
): string {
  const companyName = String(formData.companyName || '').trim() || 'N/A';
  const email = String(formData.email || '').trim();
  const emailHtml = email
    ? `<a href="mailto:${escapeHtml(email)}" style="color:#A81B32;text-decoration:none;font-weight:500;">${escapeHtml(email)}</a>`
    : 'N/A';
  const marketCap = String(formData.marketCap || '').trim() || 'N/A';
  const exchangeTicker = String(formData.primaryExchangeTicker || formData.ticker || '').trim() || 'N/A';
  const commodity = String(formData.commodity || '').trim() || 'N/A';
  const projectStage = String(formData.projectStage || '').trim() || 'N/A';
  const location = String(formData.location || '').trim() || 'N/A';
  const about = String(formData.tellUsAboutYourself || formData.aboutYou || formData.about || '').trim();
  const aboutHtml = about
    ? escapeHtml(about).replace(/\r?\n/g, '<br />')
    : '<span style="color:#A0AEC0;">None provided</span>';
  const optInText = formData.newsletterOptIn ? 'Yes' : 'No';

  let html = templateHtml;

  html = html.replace(/\{\{Company Name\}\}/g, escapeHtml(companyName));
  html = html.replace(/\{\{Email\}\}/g, emailHtml);
  html = html.replace(/\{\{Market Cap\}\}/g, escapeHtml(marketCap));
  html = html.replace(/\{\{Primary Exchange\/Ticker\}\}/g, escapeHtml(exchangeTicker));
  html = html.replace(/\{\{Commodity\}\}/g, escapeHtml(commodity));
  html = html.replace(/\{\{Project Stage\}\}/g, escapeHtml(projectStage));
  html = html.replace(/\{\{Location\}\}/g, escapeHtml(location));
  html = html.replace(/\{\{Tell Us About Yourself\}\}/g, aboutHtml);
  html = html.replace(/\{\{Sign up for news and updates\}\}/g, optInText);

  // Inject Reference and Submitted date into Status block
  const statusMeta = `
              <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #E8A8B2; font-family: 'Inter', Helvetica, Arial, sans-serif; font-size: 12px; color: #718096;">
                ${reference ? `<div>Registration Reference: <strong style="color: #1E2229;">${escapeHtml(reference)}</strong></div>` : ''}
                <div style="margin-top: 4px;">Submitted At: <strong style="color: #1E2229;">${escapeHtml(formatDate(submittedAt))}</strong></div>
              </div>`;

  html = html.replace(/\{\{Status Meta\}\}/g, statusMeta);

  return html;
}

function renderInvestorTemplate(
  templateHtml: string,
  formData: Record<string, unknown>,
  submittedAt: Date,
  reference?: string
): string {
  const companyName = String(formData.companyName || '').trim() || 'N/A';
  const firstName = String(formData.firstName || '').trim();
  const lastName = String(formData.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'N/A';
  const businessTitle = String(formData.businessTitle || '').trim() || 'N/A';
  const email = String(formData.email || '').trim();
  const emailHtml = email
    ? `<a href="mailto:${escapeHtml(email)}" style="color:#A81B32;text-decoration:none;font-weight:500;">${escapeHtml(email)}</a>`
    : 'N/A';
  const phone = String(formData.phone || '').trim() || 'N/A';
  const city = String(formData.city || '').trim() || 'N/A';
  const country = String(formData.country || '').trim() || 'N/A';
  const aum = String(formData.assetsUnderManagement || formData.aum || '').trim() || 'N/A';
  const investorType = String(formData.investorType || '').trim() || 'N/A';
  const about = String(formData.tellUsAboutYourself || formData.aboutYou || formData.about || '').trim();
  const aboutHtml = about
    ? escapeHtml(about).replace(/\r?\n/g, '<br />')
    : '<span style="color:#A0AEC0;">None provided</span>';
  const optInText = formData.newsletterOptIn ? 'Yes' : 'No';

  let html = templateHtml;

  html = html.replace(/\{\{Company Name\}\}/g, escapeHtml(companyName));
  html = html.replace(/\{\{First Name\}\}\s*\{\{Last Name\}\}/g, escapeHtml(fullName));
  html = html.replace(/\{\{First Name\}\}/g, escapeHtml(firstName || 'N/A'));
  html = html.replace(/\{\{Last Name\}\}/g, escapeHtml(lastName || 'N/A'));
  html = html.replace(/\{\{Business Title\}\}/g, escapeHtml(businessTitle));
  html = html.replace(/\{\{Email\}\}/g, emailHtml);
  html = html.replace(/\{\{Phone\}\}/g, escapeHtml(phone));
  html = html.replace(/\{\{City\}\}/g, escapeHtml(city));
  html = html.replace(/\{\{Country\}\}/g, escapeHtml(country));
  html = html.replace(/\{\{Assets Under Management\}\}/g, escapeHtml(aum));
  html = html.replace(/\{\{Investor Type\}\}/g, escapeHtml(investorType));
  html = html.replace(/\{\{Investment Focus \/ Objectives\}\}/g, aboutHtml);
  html = html.replace(/\{\{Sign up for news and updates\}\}/g, optInText);

  // Inject Reference and Submitted date into Status block
  const statusMeta = `
              <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #E8A8B2; font-family: 'Inter', Helvetica, Arial, sans-serif; font-size: 12px; color: #718096;">
                ${reference ? `<div>Registration Reference: <strong style="color: #1E2229;">${escapeHtml(reference)}</strong></div>` : ''}
                <div style="margin-top: 4px;">Submitted At: <strong style="color: #1E2229;">${escapeHtml(formatDate(submittedAt))}</strong></div>
              </div>`;

  html = html.replace(/\{\{Status Meta\}\}/g, statusMeta);

  return html;
}

function renderGenericHtml(
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

function renderHtml(
  definition: FormDefinition,
  formType: FormType,
  formData: Record<string, unknown>,
  media: Record<string, MediaSummary | undefined>,
  rows: DisplayRow[],
  submittedAt: Date,
  reference?: string
): string {
  const rawTemplate = getTemplateRaw(formType);
  if (rawTemplate) {
    if (formType === 'studentSponsorship') {
      return renderStudentSponsorshipTemplate(rawTemplate, formData, media, submittedAt, reference);
    }
    if (formType === 'company') {
      return renderCompanyTemplate(rawTemplate, formData, submittedAt, reference);
    }
    if (formType === 'investor') {
      return renderInvestorTemplate(rawTemplate, formData, submittedAt, reference);
    }
  }

  return renderGenericHtml(definition, rows, submittedAt, reference);
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

  const html = renderHtml(
    definition,
    input.formType,
    input.formData,
    input.media ?? {},
    rows,
    submittedAt,
    input.reference
  );
  const text = renderText(definition, rows, submittedAt, input.reference);

  let response: Awaited<ReturnType<Resend['emails']['send']>>;
  try {
    response = await getResendClient(apiKey).emails.send({
      from,
      to: recipient,
      subject: definition.subject,
      html,
      text,
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
