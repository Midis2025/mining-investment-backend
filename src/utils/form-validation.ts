/**
 * Server-side validation for public form submissions.
 *
 * The frontend does its own validation, but nothing here trusts it: every
 * request is normalised and re-validated against the form definition before it
 * reaches the database.
 */

import type { FieldDefinition, FormDefinition } from './form-definitions';

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  data: Record<string, unknown>;
  errors: FieldError[];
}

/**
 * Deliberately conservative: rejects whitespace, multiple @, and missing TLD.
 * Anything that passes this is safe to hand to Resend as a Reply-To.
 */
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

/** Accepts the several shapes a checkbox can arrive in (JSON bool, form-encoded string). */
function coerceBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
}

/** Media arrives as an upload id (or a list of them) — never as a file path. */
function coerceMediaId(raw: unknown): number | number[] | undefined {
  const toId = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
      return toId((value as Record<string, unknown>).id);
    }
    return undefined;
  };

  if (Array.isArray(raw)) {
    const ids = raw.map(toId).filter((id): id is number => id !== undefined);
    return ids.length > 0 ? ids : undefined;
  }
  return toId(raw);
}

/**
 * Folds a value for lenient enum matching: case, surrounding/repeated
 * whitespace and accents are ignored, so "français" and "Francais" both reach
 * the canonical option.
 */
const COMBINING_MARKS = /[̀-ͯ]/g;

function foldForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Resolves a submitted value to one of the canonical enumeration options,
 * checking exact matches first, then aliases, then the folded forms.
 */
function resolveEnumValue(field: FieldDefinition, value: string): string | undefined {
  if (field.valueAliases?.[value]) return field.valueAliases[value];
  if (!field.values) return value;
  if (field.values.includes(value)) return value;

  const folded = foldForMatch(value);

  for (const [alias, canonical] of Object.entries(field.valueAliases ?? {})) {
    if (foldForMatch(alias) === folded) return canonical;
  }

  return field.values.find((option) => foldForMatch(option) === folded);
}

/** Reads a field from the body, honouring the aliases the frontend may use. */
function readRawValue(body: Record<string, unknown>, field: FieldDefinition): unknown {
  if (body[field.name] !== undefined) return body[field.name];
  for (const alias of field.aliases ?? []) {
    if (body[alias] !== undefined) return body[alias];
  }
  return undefined;
}

/**
 * Unwraps the request body. Strapi's core create expects `{ data: {...} }`;
 * the website posts a flat object. Both are accepted.
 */
export function unwrapBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const inner = record.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return record;
}

/**
 * Validates and normalises a submission.
 *
 * Only fields declared on the form definition survive — unknown keys (including
 * any attempt to set `emailStatus` or a recipient address) are dropped.
 */
export function validateSubmission(
  definition: FormDefinition,
  body: Record<string, unknown>
): ValidationResult {
  const data: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const field of definition.fields) {
    const raw = readRawValue(body, field);

    if (field.kind === 'boolean') {
      const value = coerceBoolean(raw);
      if (raw !== undefined && value === undefined) {
        errors.push({ field: field.name, message: `${field.label} must be true or false.` });
      } else if (value !== undefined) {
        data[field.name] = value;
      }
      continue;
    }

    if (field.kind === 'media') {
      const value = coerceMediaId(raw);
      if (raw !== undefined && raw !== null && raw !== '' && value === undefined) {
        errors.push({
          field: field.name,
          message: `${field.label} must be an uploaded file reference.`,
        });
      } else if (value !== undefined) {
        data[field.name] = value;
      }
      continue;
    }

    // Everything else is text-like.
    if (raw !== undefined && raw !== null && typeof raw !== 'string' && typeof raw !== 'number') {
      errors.push({ field: field.name, message: `${field.label} is invalid.` });
      continue;
    }

    const value = raw === undefined || raw === null ? '' : String(raw).trim();

    if (value === '') {
      if (field.required) {
        errors.push({ field: field.name, message: `${field.label} is required.` });
      }
      continue;
    }

    if (field.maxLength && value.length > field.maxLength) {
      errors.push({
        field: field.name,
        message: `${field.label} must be ${field.maxLength} characters or fewer.`,
      });
      continue;
    }

    if (field.kind === 'email' && !isValidEmail(value)) {
      errors.push({ field: field.name, message: `${field.label} must be a valid email address.` });
      continue;
    }

    if (field.kind === 'enumeration') {
      const canonical = resolveEnumValue(field, value);
      if (canonical === undefined) {
        errors.push({ field: field.name, message: `${field.label} is not a valid option.` });
        continue;
      }
      data[field.name] = canonical;
      continue;
    }

    data[field.name] = field.kind === 'email' ? value.toLowerCase() : value;
  }

  if (Object.keys(data).length === 0 && errors.length === 0) {
    errors.push({ field: '', message: 'Submission is empty.' });
  }

  return { data, errors };
}
