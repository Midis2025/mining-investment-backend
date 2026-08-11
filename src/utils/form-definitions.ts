/**
 * Central registry for the public website forms.
 *
 * Everything that differs between forms — the content type they are stored in,
 * the fields they accept, the notification subject and the recipient env var —
 * lives here. Controllers, validation and the email templates are all generic
 * and driven off these definitions, so adding a form later (e.g. Press Release)
 * means adding one entry here plus a three-line controller.
 */

export type FormType = 'investor' | 'company' | 'studentSponsorship';

export type FieldKind = 'string' | 'email' | 'text' | 'boolean' | 'enumeration' | 'media';

export interface FieldDefinition {
  /** Attribute name on the Strapi content type. */
  name: string;
  /** Human readable label, used in the notification email. */
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  /** Allowed values, mirroring the enumeration in schema.json. */
  values?: readonly string[];
  /** Additional request keys accepted for this field (frontend naming drift). */
  aliases?: readonly string[];
  /** Maps incoming values onto the canonical enumeration values. */
  valueAliases?: Readonly<Record<string, string>>;
}

export interface FormDefinition {
  /** Content type UID the submission is stored in. */
  uid: string;
  /** Title used in the email heading, e.g. "New Investor Registration". */
  title: string;
  /** Subject line of the notification email. */
  subject: string;
  /**
   * Name of the env var holding the recipient. The address itself is never
   * hardcoded here, and is never read from the request body.
   */
  recipientEnvVar: string;
  /** Prefix for the human readable reference returned to the submitter. */
  referencePrefix: string;
  /** Field whose value is used as Reply-To, when it is a valid address. */
  replyToField: string | null;
  /** Message returned to the frontend on success. */
  successMessage: string;
  fields: readonly FieldDefinition[];
}

/**
 * The Investor form's AUM dropdown submits abbreviated values; the content type
 * stores the long form shown in Strapi Admin.
 */
const AUM_VALUES = [
  'Under $10 Million',
  'From $10 Million - $50 Million',
  'From $50 Million - $250 Million',
  'From $250 Million - $1 Billion',
  'Over $1 Billion',
  'HNWI / Personal Accredited Investor',
] as const;

const AUM_ALIASES: Record<string, string> = {
  'Under $10M': 'Under $10 Million',
  '$10M - $50M': 'From $10 Million - $50 Million',
  '$50M - $250M': 'From $50 Million - $250 Million',
  '$250M - $1B': 'From $250 Million - $1 Billion',
  'Over $1B': 'Over $1 Billion',
  'HNWI / Personal': 'HNWI / Personal Accredited Investor',
};

const INVESTOR_TYPE_VALUES = [
  'Institutional Investor',
  'Family Office',
  'High Net Worth Individual (HNWI)',
  'Fund / Portfolio Manager',
  'Sovereign Wealth Fund',
  'Mining Analyst / Investment Banker',
  'Retail / Accredited Investor',
] as const;

const PROJECT_STAGE_VALUES = [
  'Explorer',
  'Developer',
  'Producer',
  'Royalty',
  'Project Generator',
] as const;

/** Existing enum values, including the "Francias" spelling already in the schema. */
const PREFERRED_LANGUAGE_VALUES = ['English', 'Francias', 'Bilingual'] as const;

const PREFERRED_LANGUAGE_ALIASES: Record<string, string> = {
  Francais: 'Francias',
  'Français': 'Francias',
  French: 'Francias',
};

/** The newsletter checkbox is named `signUpForNews` in the current frontend. */
const NEWSLETTER_FIELD: FieldDefinition = {
  name: 'newsletterOptIn',
  label: 'Sign up for news and updates',
  kind: 'boolean',
  aliases: ['signUpForNews', 'newsletter', 'signupForNews'],
};

export const FORM_DEFINITIONS: Readonly<Record<FormType, FormDefinition>> = {
  investor: {
    uid: 'api::investor-registeration.investor-registeration',
    title: 'New Investor Registration',
    subject: 'New Investor Registration Submission',
    recipientEnvVar: 'INVESTOR_FORM_EMAIL',
    referencePrefix: 'INV',
    replyToField: 'email',
    successMessage: 'Registration submitted successfully.',
    fields: [
      { name: 'companyName', label: 'Company Name', kind: 'string', required: true, maxLength: 200 },
      { name: 'firstName', label: 'First Name', kind: 'string', required: true, maxLength: 100 },
      { name: 'lastName', label: 'Last Name', kind: 'string', required: true, maxLength: 100 },
      { name: 'businessTitle', label: 'Business Title', kind: 'string', maxLength: 150 },
      { name: 'city', label: 'City', kind: 'string', maxLength: 100 },
      { name: 'country', label: 'Country', kind: 'string', maxLength: 100 },
      { name: 'email', label: 'Email', kind: 'email', required: true, maxLength: 254 },
      { name: 'phone', label: 'Phone', kind: 'string', maxLength: 50 },
      {
        name: 'assetsUnderManagement',
        label: 'Assets Under Management',
        kind: 'enumeration',
        values: AUM_VALUES,
        valueAliases: AUM_ALIASES,
        aliases: ['aum'],
      },
      {
        name: 'investorType',
        label: 'Investor Type',
        kind: 'enumeration',
        values: INVESTOR_TYPE_VALUES,
      },
      {
        name: 'tellUsAboutYourself',
        label: 'Tell us about yourself',
        kind: 'text',
        maxLength: 5000,
        aliases: ['aboutYou', 'about'],
      },
      NEWSLETTER_FIELD,
    ],
  },

  company: {
    uid: 'api::company-registeration.company-registeration',
    title: 'New Company Registration',
    subject: 'New Company Registration Submission',
    recipientEnvVar: 'COMPANY_FORM_EMAIL',
    referencePrefix: 'CMP',
    replyToField: 'email',
    successMessage: 'Registration submitted successfully.',
    fields: [
      { name: 'companyName', label: 'Company Name', kind: 'string', required: true, maxLength: 200 },
      { name: 'marketCap', label: 'Market Cap', kind: 'string', maxLength: 100 },
      {
        name: 'primaryExchangeTicker',
        label: 'Primary Exchange / Ticker',
        kind: 'string',
        maxLength: 100,
        aliases: ['ticker'],
      },
      { name: 'commodity', label: 'Commodity', kind: 'string', maxLength: 200 },
      {
        name: 'projectStage',
        label: 'Project Stage',
        kind: 'enumeration',
        values: PROJECT_STAGE_VALUES,
      },
      { name: 'location', label: 'Location', kind: 'string', maxLength: 200 },
      { name: 'email', label: 'Email', kind: 'email', required: true, maxLength: 254 },
      {
        name: 'tellUsAboutYourself',
        label: 'Tell us about yourself',
        kind: 'text',
        maxLength: 5000,
        aliases: ['aboutYou', 'about'],
      },
      NEWSLETTER_FIELD,
    ],
  },

  studentSponsorship: {
    uid: 'api::student-sponsorship.student-sponsorship',
    title: 'New Student Sponsorship Application',
    subject: 'New Student Sponsorship Submission',
    recipientEnvVar: 'STUDENT_SPONSORSHIP_EMAIL',
    referencePrefix: 'STU',
    replyToField: 'email',
    successMessage: 'Application submitted successfully.',
    fields: [
      { name: 'firstName', label: 'First Name', kind: 'string', required: true, maxLength: 100 },
      { name: 'lastName', label: 'Last Name', kind: 'string', required: true, maxLength: 100 },
      { name: 'email', label: 'Email', kind: 'email', required: true, maxLength: 254 },
      { name: 'phone', label: 'Phone', kind: 'string', maxLength: 50 },
      {
        name: 'schoolInstitution',
        label: 'School / Institution',
        kind: 'string',
        maxLength: 200,
        aliases: ['school', 'institution'],
      },
      {
        name: 'programYearOfStudy',
        label: 'Program & Year of Study',
        kind: 'string',
        maxLength: 200,
        aliases: ['program', 'yearOfStudy'],
      },
      {
        name: 'preferredLanguage',
        label: 'Preferred Language',
        kind: 'enumeration',
        values: PREFERRED_LANGUAGE_VALUES,
        valueAliases: PREFERRED_LANGUAGE_ALIASES,
      },
      {
        name: 'letterOfInterest',
        label: 'Letter of Interest',
        kind: 'text',
        maxLength: 10000,
      },
      { name: 'resumeCv', label: 'Resume / CV', kind: 'media', aliases: ['resume', 'cv'] },
      { name: 'transcript', label: 'Transcript', kind: 'media' },
      NEWSLETTER_FIELD,
    ],
  },

  /*
   * Press Release is intentionally NOT implemented yet. When it is, add:
   *
   * pressRelease: {
   *   uid: 'api::press-release-submission.press-release-submission',
   *   title: 'New Press Release Submission',
   *   subject: 'New Press Release Submission',
   *   recipientEnvVar: 'PRESS_RELEASE_FORM_EMAIL',   // sydney@irinc.ca
   *   referencePrefix: 'PRS',
   *   replyToField: 'email',
   *   successMessage: 'Press release submitted successfully.',
   *   fields: [...],
   * }
   *
   * ...and a controller that calls `submitForm({ strapi, ctx, formType: 'pressRelease' })`.
   * Note the existing `api::press-release` content type is editorial content used
   * by the website's news section — it is not a submission form.
   */
};

/** Media fields are stored as upload ids and rendered differently in the email. */
export function getMediaFields(definition: FormDefinition): FieldDefinition[] {
  return definition.fields.filter((field) => field.kind === 'media');
}

/**
 * Human readable reference for a submission, e.g. "INV-2026-00001". Derived
 * from stored values only, so the API response and the notification email
 * always agree.
 */
export function buildReference(
  definition: FormDefinition,
  id: number,
  createdAt: Date
): string {
  return `${definition.referencePrefix}-${createdAt.getUTCFullYear()}-${String(id).padStart(5, '0')}`;
}

/** Extracts just the declared form fields from a stored entry. */
export function pickFormData(
  definition: FormDefinition,
  entry: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (entry[field.name] !== undefined && entry[field.name] !== null) {
      data[field.name] = entry[field.name];
    }
  }
  return data;
}
