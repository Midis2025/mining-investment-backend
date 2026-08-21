/**
 * Source-tagged Mailchimp sync for the per-website registration content types
 * (Noble Mining Investment Conference, International Mining Week).
 *
 * These registrations reuse the two existing shared audiences:
 *
 *   Investor Registration audience -> MAILCHIMP_INVESTOR_AUDIENCE_ID
 *   Company Registration audience  -> MAILCHIMP_COMPANY_AUDIENCE_ID
 *
 * No per-website audience exists or is created. The website a registration came
 * from is recorded as a Mailchimp *tag* resolved from `sourceWebsite` (see
 * ./source-website), and the Mailchimp Automations trigger on that tag to send
 * the right template. This backend never sends the marketing email itself.
 *
 * Runs from the content type's `afterCreate` lifecycle on the next tick, so a
 * slow or failing Mailchimp call can never hold up or roll back the stored
 * registration. Entirely separate from the Resend notification path.
 */

import type { Core } from '@strapi/strapi';

import {
  addOrUpdateMember,
  getAudienceId,
  MailchimpError,
  type MailchimpMemberResult,
  type MailchimpMemberStatus,
  type MailchimpTarget,
} from './mailchimp';
import { resolveSourceTag, SOURCE_WEBSITES, type SourceWebsite } from './source-website';

export interface RegistrationLifecycleEvent {
  result?: Record<string, unknown>;
}

/** Registration content types that route by source website. */
export type RegistrationKind =
  | 'noble-investor'
  | 'noble-company'
  | 'imw-investor'
  | 'imw-company';

interface RegistrationDefinition {
  uid: string;
  /** Prefix used in logs, e.g. "[noble-investor]". */
  label: string;
  /** Which existing shared audience this registration category belongs to. */
  target: Extract<MailchimpTarget, 'investor' | 'company'>;
  /** Human readable audience name, used in logs only. */
  audienceLabel: string;
  /** Log wording. */
  category: 'investor' | 'company';
  /**
   * The website this content type belongs to, used when `sourceWebsite` is
   * absent or blank. This is not an inference from request metadata — the
   * content type itself only ever receives that website's registrations — so
   * an admin-created entry still reaches the right automation. A value that is
   * present but unrecognised is never rewritten to this; it warns instead.
   */
  fallbackSource: SourceWebsite;
  buildMergeFields(entry: Record<string, unknown>): Record<string, unknown>;
}

/** True when no source was supplied at all, as opposed to an unrecognised one. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Joins city and country into the LOCATION merge field used by the company audience. */
function buildLocation(entry: Record<string, unknown>): string | undefined {
  const parts = [text(entry.city), text(entry.country)].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function assign(
  target: Record<string, unknown>,
  fields: Record<string, string | undefined>
): void {
  for (const [tag, value] of Object.entries(fields)) {
    if (value !== undefined) target[tag] = value;
  }
}

/**
 * Investor merge fields, matching exactly the set the existing Mining
 * Investment Event investor sync already writes to this audience. Free-text
 * fields (investmentFocus) are deliberately excluded.
 */
function buildInvestorMergeFields(entry: Record<string, unknown>): Record<string, unknown> {
  const mergeFields: Record<string, unknown> = {};
  assign(mergeFields, {
    FNAME: text(entry.firstName),
    LNAME: text(entry.lastName),
    COMPANY: text(entry.companyName),
    TITLE: text(entry.businessTitle),
    CITY: text(entry.city),
    COUNTRY: text(entry.country),
    PHONE: text(entry.phone),
    AUM: text(entry.assetsUnderManagement),
    INVTYPE: text(entry.investorType),
  });
  mergeFields.OPTIN = entry.newsletterOptIn ? 'Yes' : 'No';
  return mergeFields;
}

/**
 * Company merge fields, restricted to the tags the existing Mining Investment
 * Event company sync already writes to this audience (plus Mailchimp's own
 * FNAME/LNAME). Free-text fields are deliberately excluded.
 */
function buildCompanyMergeFields(
  entry: Record<string, unknown>,
  commodity: string | undefined,
  stage: string | undefined
): Record<string, unknown> {
  const mergeFields: Record<string, unknown> = {};
  assign(mergeFields, {
    FNAME: text(entry.firstName),
    LNAME: text(entry.lastName),
    COMPANY: text(entry.companyName),
    TICKER: text(entry.tickerSymbolExchange),
    MARKETCAP: text(entry.marketCapRange),
    COMMODITY: commodity,
    STAGE: stage,
    LOCATION: buildLocation(entry),
  });
  mergeFields.OPTIN = entry.newsletterOptIn ? 'Yes' : 'No';
  return mergeFields;
}

const REGISTRATION_DEFINITIONS: Readonly<Record<RegistrationKind, RegistrationDefinition>> = {
  'noble-investor': {
    uid: 'api::noble-investor-registration.noble-investor-registration',
    label: 'noble-investor',
    target: 'investor',
    audienceLabel: 'Investor Registration',
    category: 'investor',
    fallbackSource: SOURCE_WEBSITES.nobleMiningInvestmentConference,
    buildMergeFields: buildInvestorMergeFields,
  },
  'noble-company': {
    uid: 'api::noble-company-registration.noble-company-registration',
    label: 'noble-company',
    target: 'company',
    audienceLabel: 'Company Registration',
    category: 'company',
    fallbackSource: SOURCE_WEBSITES.nobleMiningInvestmentConference,
    buildMergeFields: (entry) =>
      buildCompanyMergeFields(entry, text(entry.primaryCommodityResource), undefined),
  },
  'imw-investor': {
    uid: 'api::imw-investor-registeration.imw-investor-registeration',
    label: 'imw-investor',
    target: 'investor',
    audienceLabel: 'Investor Registration',
    category: 'investor',
    fallbackSource: SOURCE_WEBSITES.internationalMiningWeek,
    buildMergeFields: buildInvestorMergeFields,
  },
  'imw-company': {
    uid: 'api::imw-comapny-registeration.imw-comapny-registeration',
    label: 'imw-company',
    target: 'company',
    audienceLabel: 'Company Registration',
    category: 'company',
    fallbackSource: SOURCE_WEBSITES.internationalMiningWeek,
    buildMergeFields: (entry) =>
      buildCompanyMergeFields(entry, undefined, text(entry.primaryAssetStageFocus)),
  },
};

function getStrapi(): Core.Strapi {
  return (global as unknown as { strapi: Core.Strapi }).strapi;
}

/**
 * Hook for a content type's `afterCreate` lifecycle. Deferred to the next tick
 * so the create has committed and the API response is never delayed.
 */
export function syncRegistrationMailchimpOnCreate(
  kind: RegistrationKind,
  event: RegistrationLifecycleEvent
): void {
  const entry = event.result;
  if (!entry) return;

  // Lets an admin (or a data import) opt out by setting the status up front.
  if (entry.mailchimpStatus === 'synced') return;

  setImmediate(() => {
    void deliverRegistrationMailchimpSync(kind, entry);
  });
}

/**
 * Adds or updates the contact in the shared audience for this registration
 * category and applies the source website tag.
 *
 * Uses the committed lifecycle result directly rather than re-reading the
 * document: these content types use draft & publish, and the entry we want is
 * precisely the one that was just created.
 */
export async function deliverRegistrationMailchimpSync(
  kind: RegistrationKind,
  entry: Record<string, unknown>
): Promise<MailchimpMemberResult | null> {
  const strapi = getStrapi();
  if (!strapi) return null;

  const definition = REGISTRATION_DEFINITIONS[kind];
  if (!definition) return null;

  const email = String(entry.email || '').trim().toLowerCase();
  if (!email) {
    strapi.log.warn(
      `[Mailchimp] [${definition.label}] registration has no email address; skipping sync.`
    );
    return null;
  }

  strapi.log.info(
    `[Mailchimp] Processing ${definition.category} registration (${definition.label})`
  );

  const audienceId = getAudienceId(definition.target);
  if (!audienceId) {
    const message = `MAILCHIMP_${definition.target.toUpperCase()}_AUDIENCE_ID is not configured.`;
    strapi.log.warn(`[Mailchimp] [${definition.label}] ${message} Skipping Mailchimp sync.`);
    await recordMailchimpStatus(strapi, definition, entry, {
      mailchimpStatus: 'failed',
      mailchimpError: message,
    });
    return null;
  }

  // Blank means "not supplied" — fall back to the website this content type
  // belongs to, so admin-created entries still reach the right automation.
  // A value that is present but unrecognised is never rewritten: that is a
  // mistake worth surfacing, not something to guess past.
  let sourceTag = resolveSourceTag(entry.sourceWebsite);
  if (sourceTag) {
    strapi.log.info(`[Mailchimp] Source: ${sourceTag}`);
  } else if (isBlank(entry.sourceWebsite)) {
    sourceTag = definition.fallbackSource;
    strapi.log.info(`[Mailchimp] Source: ${sourceTag} (default for ${definition.label})`);
  } else {
    strapi.log.warn(
      `[Mailchimp] [${definition.label}] sourceWebsite was supplied but is not a ` +
        'recognised website - no source tag will be applied and no source automation ' +
        'will trigger. The registration is still stored and the contact is still ' +
        'synchronised.'
    );
  }

  strapi.log.info(`[Mailchimp] Audience: ${definition.audienceLabel}`);

  const newsletterOptIn = Boolean(entry.newsletterOptIn);
  const statusIfNew: MailchimpMemberStatus = newsletterOptIn ? 'subscribed' : 'unsubscribed';
  const tags = sourceTag ? [sourceTag] : [];

  // The source is recorded twice on purpose: as a tag, which the Automations
  // trigger on, and as the SOURCE merge field, so the originating website is
  // readable on the contact itself. An unresolved source sets neither.
  const mergeFields = definition.buildMergeFields(entry);
  if (sourceTag) {
    mergeFields.SOURCE = sourceTag;
  }

  if (sourceTag) {
    strapi.log.info(`[Mailchimp] Applying tag: ${sourceTag}`);
  }

  try {
    const result = await addOrUpdateMember({
      target: definition.target,
      audienceId,
      email,
      firstName: text(entry.firstName),
      lastName: text(entry.lastName),
      mergeFields,
      tags,
      statusIfNew,
    });

    await recordMailchimpStatus(strapi, definition, entry, {
      mailchimpStatus: 'synced',
      mailchimpMemberId: result.id,
      mailchimpSyncedAt: new Date(),
      mailchimpError: null,
    });

    strapi.log.info(
      `[Mailchimp] ${definition.category === 'investor' ? 'Investor' : 'Company'} contact ` +
        `${sourceTag ? 'tagged' : 'synchronised'} successfully (${result.status})`
    );

    return result;
  } catch (error) {
    const message =
      error instanceof MailchimpError || error instanceof Error
        ? error.message
        : 'Unknown Mailchimp synchronization error.';

    // The message never contains credentials - MailchimpError carries only the
    // API's own status/detail text.
    strapi.log.error(`[Mailchimp] [${definition.label}] synchronization failed: ${message}`);

    await recordMailchimpStatus(strapi, definition, entry, {
      mailchimpStatus: 'failed',
      mailchimpError: message.slice(0, 1000),
    });

    return null;
  }
}

/**
 * Best-effort status write straight to the row that was just created. Uses the
 * query engine rather than the Document Service so it targets the exact entry
 * regardless of draft/publish state and cannot re-enter document lifecycles.
 * A failure here must never escape - the registration is already safely stored.
 */
async function recordMailchimpStatus(
  strapi: Core.Strapi,
  definition: RegistrationDefinition,
  entry: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<void> {
  const id = Number(entry.id);
  if (!Number.isInteger(id) || id <= 0) return;

  try {
    await strapi.db
      .query(definition.uid as Parameters<Core.Strapi['db']['query']>[0])
      .update({ where: { id }, data });
  } catch (error) {
    strapi.log.error(
      `[Mailchimp] Failed to record sync status on ${definition.uid} #${id}`,
      error
    );
  }
}
