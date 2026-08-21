/**
 * Mailchimp Audience Synchronization for Registration Forms.
 *
 * Dispatches contact and merge field data to dedicated Mailchimp Audiences:
 * - Company Registration   -> MAILCHIMP_COMPANY_AUDIENCE_ID
 * - Investor Registration  -> MAILCHIMP_INVESTOR_AUDIENCE_ID
 * - Student Sponsorship    -> MAILCHIMP_STUDENT_AUDIENCE_ID
 *
 * Driven by the content-type `afterCreate` lifecycle non-blockingly,
 * completely isolated from Resend notifications.
 */

import type { Core } from '@strapi/strapi';
import { FORM_DEFINITIONS, type FormType } from './form-definitions';
import {
  addOrUpdateMember,
  getAudienceId,
  MailchimpError,
  type MailchimpMemberResult,
  type MailchimpMemberStatus,
  type MailchimpTarget,
} from './mailchimp';
import { resolveSourceTag } from './source-website';

export interface MailchimpLifecycleEvent {
  result?: Record<string, unknown>;
}

function getStrapi(): Core.Strapi {
  return (global as unknown as { strapi: Core.Strapi }).strapi;
}

/**
 * Maps Strapi FormType to Mailchimp target audience identifier.
 */
export function mapFormTypeToMailchimpTarget(formType: FormType): MailchimpTarget {
  switch (formType) {
    case 'company':
      return 'company';
    case 'investor':
      return 'investor';
    case 'studentSponsorship':
      return 'student';
  }
}

/**
 * Constructs sanitized merge fields and options for Mailchimp Audience based on form type and entry data.
 * Files/media (such as resumeCv and transcript) are strictly excluded from Mailchimp.
 */
export function buildMailchimpPayload(
  formType: FormType,
  entry: Record<string, unknown>
): {
  email: string;
  firstName?: string;
  lastName?: string;
  mergeFields: Record<string, unknown>;
  tags: string[];
  statusIfNew: MailchimpMemberStatus;
} {
  const email = String(entry.email || '').trim().toLowerCase();
  const newsletterOptIn = Boolean(entry.newsletterOptIn);
  const statusIfNew: MailchimpMemberStatus = newsletterOptIn ? 'subscribed' : 'unsubscribed';

  const mergeFields: Record<string, unknown> = {};
  const tags: string[] = [];
  let firstName: string | undefined;
  let lastName: string | undefined;

  switch (formType) {
    case 'company': {
      tags.push('Company Registration');
      if (entry.companyName) mergeFields.COMPANY = String(entry.companyName).trim();
      if (entry.marketCap) mergeFields.MARKETCAP = String(entry.marketCap).trim();
      if (entry.primaryExchangeTicker) mergeFields.TICKER = String(entry.primaryExchangeTicker).trim();
      if (entry.commodity) mergeFields.COMMODITY = String(entry.commodity).trim();
      if (entry.projectStage) mergeFields.STAGE = String(entry.projectStage).trim();
      if (entry.location) mergeFields.LOCATION = String(entry.location).trim();
      mergeFields.OPTIN = newsletterOptIn ? 'Yes' : 'No';
      break;
    }

    case 'investor': {
      tags.push('Investor Registration');
      if (entry.firstName) {
        firstName = String(entry.firstName).trim();
        mergeFields.FNAME = firstName;
      }
      if (entry.lastName) {
        lastName = String(entry.lastName).trim();
        mergeFields.LNAME = lastName;
      }
      if (entry.companyName) mergeFields.COMPANY = String(entry.companyName).trim();
      if (entry.businessTitle) mergeFields.TITLE = String(entry.businessTitle).trim();
      if (entry.city) mergeFields.CITY = String(entry.city).trim();
      if (entry.country) mergeFields.COUNTRY = String(entry.country).trim();
      if (entry.phone) mergeFields.PHONE = String(entry.phone).trim();
      if (entry.assetsUnderManagement) mergeFields.AUM = String(entry.assetsUnderManagement).trim();
      if (entry.investorType) mergeFields.INVTYPE = String(entry.investorType).trim();
      mergeFields.OPTIN = newsletterOptIn ? 'Yes' : 'No';
      break;
    }

    case 'studentSponsorship': {
      tags.push('Student Sponsorship');
      if (entry.firstName) {
        firstName = String(entry.firstName).trim();
        mergeFields.FNAME = firstName;
      }
      if (entry.lastName) {
        lastName = String(entry.lastName).trim();
        mergeFields.LNAME = lastName;
      }
      if (entry.phone) mergeFields.PHONE = String(entry.phone).trim();
      if (entry.schoolInstitution) mergeFields.SCHOOL = String(entry.schoolInstitution).trim();
      if (entry.programYearOfStudy) mergeFields.PROGRAM = String(entry.programYearOfStudy).trim();
      if (entry.preferredLanguage) mergeFields.LANGUAGE = String(entry.preferredLanguage).trim();
      mergeFields.OPTIN = newsletterOptIn ? 'Yes' : 'No';
      // Notice: resumeCv and transcript media files are explicitly excluded here.
      break;
    }
  }

  // The website the submission came from, added alongside — never instead of —
  // the registration category tag above, so an existing contact keeps every
  // source it has ever registered from. An unknown or missing value adds
  // nothing rather than guessing a source.
  const sourceTag = resolveSourceTag(entry.sourceWebsite);
  if (sourceTag) {
    if (!tags.includes(sourceTag)) {
      tags.push(sourceTag);
    }
    // Also stored as the SOURCE merge field so the originating website is
    // readable on the contact, not only inferable from its tags.
    mergeFields.SOURCE = sourceTag;
  }

  return {
    email,
    firstName,
    lastName,
    mergeFields,
    tags,
    statusIfNew,
  };
}

/**
 * Hook for content type's `afterCreate` lifecycle to sync to Mailchimp asynchronously.
 */
export function syncMailchimpOnCreate(
  formType: FormType,
  event: MailchimpLifecycleEvent
): void {
  const entry = event.result;
  if (!entry) return;

  const documentId = typeof entry.documentId === 'string' ? entry.documentId : '';
  if (!documentId) return;

  // If already marked as synced, skip
  if (entry.mailchimpStatus === 'synced') return;

  setImmediate(() => {
    void deliverMailchimpSync(formType, documentId);
  });
}

/**
 * Executes the synchronization of a registration entry to its dedicated Mailchimp audience.
 */
export async function deliverMailchimpSync(
  formType: FormType,
  documentId: string
): Promise<MailchimpMemberResult | null> {
  const strapi = getStrapi();
  if (!strapi) return null;

  const definition = FORM_DEFINITIONS[formType];
  if (!definition) return null;

  const target = mapFormTypeToMailchimpTarget(formType);
  const audienceId = getAudienceId(target);

  if (!audienceId) {
    strapi.log.warn(
      `[${formType}] Mailchimp audience ID for ${target} is not configured. Skipping Mailchimp sync.`
    );
    await recordMailchimpStatus(strapi, definition.uid, documentId, {
      mailchimpStatus: 'failed',
      mailchimpError: `MAILCHIMP_${target.toUpperCase()}_AUDIENCE_ID is not configured.`,
    });
    return null;
  }

  let entry: Record<string, unknown> | null = null;
  try {
    const documents = strapi.documents(definition.uid as Parameters<Core.Strapi['documents']>[0]);
    entry = (await (documents as any).findOne({
      documentId,
    })) as Record<string, unknown> | null;
  } catch (error) {
    strapi.log.error(`[${formType}] could not load document ${documentId} for Mailchimp sync`, error);
    return null;
  }

  if (!entry) return null;
  if (entry.mailchimpStatus === 'synced') return null;

  const { email, firstName, lastName, mergeFields, tags, statusIfNew } = buildMailchimpPayload(
    formType,
    entry
  );

  if (!email) {
    strapi.log.warn(`[${formType}] document ${documentId} has no email address for Mailchimp.`);
    return null;
  }

  strapi.log.info(`[Mailchimp] Processing ${formType} registration`);

  const sourceTag = resolveSourceTag(entry.sourceWebsite);
  if (sourceTag) {
    strapi.log.info(`[Mailchimp] Source: ${sourceTag}`);
    strapi.log.info(`[Mailchimp] Applying tag: ${sourceTag}`);
  } else {
    strapi.log.warn(
      `[${formType}] sourceWebsite is missing or unrecognised - no source tag applied. ` +
        'The registration is still stored and the contact is still synchronised.'
    );
  }

  try {
    const result = await addOrUpdateMember({
      target,
      audienceId,
      email,
      firstName,
      lastName,
      mergeFields,
      tags,
      statusIfNew,
    });

    await recordMailchimpStatus(strapi, definition.uid, documentId, {
      mailchimpStatus: 'synced',
      mailchimpMemberId: result.id,
      mailchimpSyncedAt: new Date().toISOString(),
      mailchimpError: null,
    });

    strapi.log.info(
      `[${formType}] Successfully synchronized ${email} to Mailchimp ${target} audience (${result.status})`
    );

    return result;
  } catch (error) {
    const message =
      error instanceof MailchimpError || error instanceof Error
        ? error.message
        : 'Unknown Mailchimp synchronization error.';

    strapi.log.error(`[${formType}] Mailchimp synchronization failed for ${email}:`, error);

    await recordMailchimpStatus(strapi, definition.uid, documentId, {
      mailchimpStatus: 'failed',
      mailchimpError: message.slice(0, 1000),
    });

    return null;
  }
}

/**
 * Records Mailchimp sync outcome in Strapi database.
 */
async function recordMailchimpStatus(
  strapi: Core.Strapi,
  uid: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const documents = strapi.documents(uid as Parameters<Core.Strapi['documents']>[0]);
    await (documents as any).update({ documentId, data });
  } catch (error) {
    strapi.log.error(`Failed to record Mailchimp status on ${uid} ${documentId}`, error);
  }
}
