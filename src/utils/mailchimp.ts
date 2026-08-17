/**
 * Mailchimp Marketing API Service.
 *
 * Handles member synchronization, audience routing, custom merge fields,
 * tagging, and optional Customer Journey triggers across multiple audiences:
 * - General Subscriber / Newsletter
 * - Company Registration
 * - Investor Registration
 * - Student Sponsorship
 *
 * All credentials and audience IDs are resolved server-side from environment variables.
 */

import crypto from 'crypto';

export type MailchimpTarget = 'subscriber' | 'company' | 'investor' | 'student';

export class MailchimpError extends Error {
  readonly status?: number;
  readonly detail?: string;
  readonly title?: string;

  constructor(message: string, options?: { status?: number; detail?: string; title?: string }) {
    super(message);
    this.name = 'MailchimpError';
    this.status = options?.status;
    this.detail = options?.detail;
    this.title = options?.title;
  }
}

export interface MailchimpConfig {
  apiKey: string;
  serverPrefix: string;
  audienceId: string;
  journeyId?: string;
  journeyStepId?: string;
  defaultTag?: string;
}

export type MailchimpMemberStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'pending'
  | 'transactional'
  | 'cleaned';

export interface AddOrUpdateMemberInput {
  email: string;
  audienceId?: string;
  target?: MailchimpTarget;
  firstName?: string;
  lastName?: string;
  mergeFields?: Record<string, unknown>;
  tags?: string[];
  statusIfNew?: MailchimpMemberStatus;
  status?: MailchimpMemberStatus;
  journeyId?: string;
  journeyStepId?: string;
  defaultTag?: string;
}

export interface AddOrUpdateSubscriberInput {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
  statusIfNew?: 'subscribed' | 'pending';
}

export interface MailchimpMemberResult {
  id: string;
  emailAddress: string;
  status: string;
  isNew?: boolean;
}

/**
 * Calculates MD5 hash of lowercase trimmed email address as required by Mailchimp.
 */
export function getSubscriberHash(email: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Resolves the Mailchimp Audience ID for a specific target audience.
 */
export function getAudienceId(target: MailchimpTarget = 'subscriber'): string {
  switch (target) {
    case 'subscriber':
      return (
        process.env.MAILCHIMP_SUBSCRIBER_AUDIENCE_ID?.trim() ||
        process.env.MAILCHIMP_AUDIENCE_ID?.trim() ||
        ''
      );
    case 'company':
      return process.env.MAILCHIMP_COMPANY_AUDIENCE_ID?.trim() || '';
    case 'investor':
      return process.env.MAILCHIMP_INVESTOR_AUDIENCE_ID?.trim() || '';
    case 'student':
      return process.env.MAILCHIMP_STUDENT_AUDIENCE_ID?.trim() || '';
    default:
      return '';
  }
}

/**
 * Resolves global Mailchimp credentials.
 */
export function getMailchimpAuth(): { apiKey: string; serverPrefix: string } {
  const apiKey = process.env.MAILCHIMP_API_KEY?.trim() || '';
  let serverPrefix = process.env.MAILCHIMP_SERVER_PREFIX?.trim() || '';

  if (!serverPrefix && apiKey.includes('-')) {
    const parts = apiKey.split('-');
    serverPrefix = parts[parts.length - 1];
  }

  return { apiKey, serverPrefix };
}

/**
 * Resolves Mailchimp configuration for a specific target audience from environment variables.
 */
export function getMailchimpConfig(target: MailchimpTarget = 'subscriber'): MailchimpConfig {
  const { apiKey, serverPrefix } = getMailchimpAuth();
  const audienceId = getAudienceId(target);

  let journeyId: string | undefined;
  let journeyStepId: string | undefined;
  let defaultTag: string | undefined;

  switch (target) {
    case 'subscriber':
      journeyId = process.env.MAILCHIMP_JOURNEY_ID?.trim() || undefined;
      journeyStepId = process.env.MAILCHIMP_JOURNEY_STEP_ID?.trim() || undefined;
      defaultTag = process.env.MAILCHIMP_SUBSCRIBER_TAG?.trim() || undefined;
      break;
    case 'company':
      journeyId = process.env.MAILCHIMP_COMPANY_JOURNEY_ID?.trim() || undefined;
      journeyStepId = process.env.MAILCHIMP_COMPANY_JOURNEY_STEP_ID?.trim() || undefined;
      defaultTag = process.env.MAILCHIMP_COMPANY_TAG?.trim() || undefined;
      break;
    case 'investor':
      journeyId = process.env.MAILCHIMP_INVESTOR_JOURNEY_ID?.trim() || undefined;
      journeyStepId = process.env.MAILCHIMP_INVESTOR_JOURNEY_STEP_ID?.trim() || undefined;
      defaultTag = process.env.MAILCHIMP_INVESTOR_TAG?.trim() || undefined;
      break;
    case 'student':
      journeyId = process.env.MAILCHIMP_STUDENT_JOURNEY_ID?.trim() || undefined;
      journeyStepId = process.env.MAILCHIMP_STUDENT_JOURNEY_STEP_ID?.trim() || undefined;
      defaultTag = process.env.MAILCHIMP_STUDENT_TAG?.trim() || undefined;
      break;
  }

  return {
    apiKey,
    serverPrefix,
    audienceId,
    journeyId,
    journeyStepId,
    defaultTag,
  };
}

/**
 * Validates that required Mailchimp credentials and audience ID are present.
 */
export function validateMailchimpConfig(config: MailchimpConfig): void {
  if (!config.apiKey) {
    throw new MailchimpError('MAILCHIMP_API_KEY is not configured.');
  }
  if (!config.serverPrefix) {
    throw new MailchimpError('MAILCHIMP_SERVER_PREFIX is not configured.');
  }
  if (!config.audienceId) {
    throw new MailchimpError('Mailchimp Audience ID is not configured.');
  }
}

/**
 * Helper to build standard Authorization headers for Mailchimp API.
 */
function getAuthHeader(apiKey: string): Record<string, string> {
  const token = Buffer.from(`anystring:${apiKey}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Formats and sanitizes merge fields for Mailchimp API.
 */
function sanitizeMergeFields(
  rawFields?: Record<string, unknown>,
  firstName?: string,
  lastName?: string
): Record<string, unknown> {
  const mergeFields: Record<string, unknown> = {};

  if (firstName !== undefined && firstName !== null && firstName !== '') {
    mergeFields.FNAME = String(firstName).trim();
  }
  if (lastName !== undefined && lastName !== null && lastName !== '') {
    mergeFields.LNAME = String(lastName).trim();
  }

  if (rawFields && typeof rawFields === 'object') {
    for (const [key, value] of Object.entries(rawFields)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (typeof value === 'object') {
        // Exclude file references, buffers, arrays, or objects
        continue;
      }
      const tag = key.trim().toUpperCase();
      if (tag) {
        mergeFields[tag] = typeof value === 'string' ? value.trim() : value;
      }
    }
  }

  return mergeFields;
}

/**
 * General, reusable method to add or update a member in any Mailchimp Audience.
 * Uses idempotent PUT /lists/{list_id}/members/{subscriber_hash}.
 */
export async function addOrUpdateMember(
  input: AddOrUpdateMemberInput
): Promise<MailchimpMemberResult> {
  const target = input.target || 'subscriber';
  const config = getMailchimpConfig(target);

  const audienceId = input.audienceId?.trim() || config.audienceId;
  const activeConfig: MailchimpConfig = {
    ...config,
    audienceId,
    journeyId: input.journeyId || config.journeyId,
    journeyStepId: input.journeyStepId || config.journeyStepId,
    defaultTag: input.defaultTag || config.defaultTag,
  };

  validateMailchimpConfig(activeConfig);

  const subscriberHash = getSubscriberHash(input.email);
  const url = `https://${activeConfig.serverPrefix}.api.mailchimp.com/3.0/lists/${activeConfig.audienceId}/members/${subscriberHash}`;

  const mergeFields = sanitizeMergeFields(input.mergeFields, input.firstName, input.lastName);

  const payload: Record<string, unknown> = {
    email_address: input.email.trim().toLowerCase(),
    status_if_new: input.statusIfNew || 'subscribed',
  };

  if (input.status) {
    payload.status = input.status;
  }

  if (Object.keys(mergeFields).length > 0) {
    payload.merge_fields = mergeFields;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: getAuthHeader(activeConfig.apiKey),
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new MailchimpError(
      `Network error connecting to Mailchimp: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  let responseData: any = {};
  try {
    responseData = await response.json();
  } catch {
    responseData = {};
  }

  if (!response.ok) {
    const errorDetail = responseData?.detail || responseData?.title || response.statusText;
    throw new MailchimpError(`Mailchimp API error (${response.status}): ${errorDetail}`, {
      status: response.status,
      detail: responseData?.detail,
      title: responseData?.title,
    });
  }

  // Handle tags if configured
  const tagsToAdd: string[] = [];
  if (input.tags && input.tags.length > 0) {
    tagsToAdd.push(...input.tags);
  } else if (activeConfig.defaultTag) {
    tagsToAdd.push(activeConfig.defaultTag);
  }

  if (tagsToAdd.length > 0) {
    try {
      await addSubscriberTags({
        audienceId: activeConfig.audienceId,
        email: input.email,
        tags: tagsToAdd,
      });
    } catch (tagError) {
      // Non-fatal warning if tag assignment fails
      console.warn(`[Mailchimp] Could not apply tags to member (${input.email}):`, tagError);
    }
  }

  // Handle optional Customer Journey API trigger
  if (activeConfig.journeyId && activeConfig.journeyStepId) {
    try {
      await triggerCustomerJourney({
        email: input.email,
        journeyId: activeConfig.journeyId,
        stepId: activeConfig.journeyStepId,
      });
    } catch (journeyError) {
      console.warn(`[Mailchimp] Customer Journey trigger failed for ${input.email}:`, journeyError);
    }
  }

  return {
    id: responseData.id || subscriberHash,
    emailAddress: responseData.email_address || input.email,
    status: responseData.status || 'subscribed',
  };
}

/**
 * Backward-compatible helper for Subscriber/Newsletter form.
 */
export async function addOrUpdateSubscriber(
  input: AddOrUpdateSubscriberInput
): Promise<MailchimpMemberResult> {
  return addOrUpdateMember({
    ...input,
    target: 'subscriber',
  });
}

/**
 * Adds tags to an existing subscriber in a Mailchimp Audience.
 */
export async function addSubscriberTags(input: {
  audienceId?: string;
  email: string;
  tags: string[];
}): Promise<void> {
  const audienceId = input.audienceId || getAudienceId('subscriber');
  const { apiKey, serverPrefix } = getMailchimpAuth();

  if (!apiKey || !serverPrefix || !audienceId) {
    throw new MailchimpError('Mailchimp configuration is incomplete for adding tags.');
  }

  const subscriberHash = getSubscriberHash(input.email);
  const url = `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}/tags`;

  const body = {
    tags: input.tags.map((tag) => ({
      name: tag,
      status: 'active',
    })),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeader(apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok && response.status !== 204) {
    let errorDetail = response.statusText;
    try {
      const errJson = (await response.json()) as any;
      errorDetail = errJson?.detail || errJson?.title || errorDetail;
    } catch {}
    throw new MailchimpError(`Failed to set tags in Mailchimp: ${errorDetail}`, {
      status: response.status,
    });
  }
}

/**
 * Triggers a Mailchimp Customer Journey API step for a subscriber.
 */
export async function triggerCustomerJourney(input: {
  email: string;
  journeyId: string;
  stepId: string;
}): Promise<void> {
  const { apiKey, serverPrefix } = getMailchimpAuth();
  if (!apiKey || !serverPrefix) {
    throw new MailchimpError('Mailchimp API credentials missing for customer journey trigger.');
  }

  const url = `https://${serverPrefix}.api.mailchimp.com/3.0/customer-journeys/journeys/${input.journeyId}/steps/${input.stepId}/actions/trigger`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeader(apiKey),
    body: JSON.stringify({ email_address: input.email.trim().toLowerCase() }),
  });

  if (!response.ok && response.status !== 204) {
    let errorDetail = response.statusText;
    try {
      const errJson = (await response.json()) as any;
      errorDetail = errJson?.detail || errJson?.title || errorDetail;
    } catch {}
    throw new MailchimpError(`Customer journey trigger failed: ${errorDetail}`, {
      status: response.status,
    });
  }
}

/**
 * Fetches member details from Mailchimp by email.
 */
export async function getSubscriber(
  email: string,
  target: MailchimpTarget = 'subscriber'
): Promise<MailchimpMemberResult | null> {
  const config = getMailchimpConfig(target);
  validateMailchimpConfig(config);

  const subscriberHash = getSubscriberHash(email);
  const url = `https://${config.serverPrefix}.api.mailchimp.com/3.0/lists/${config.audienceId}/members/${subscriberHash}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeader(config.apiKey),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    let errorDetail = response.statusText;
    try {
      const errJson = (await response.json()) as any;
      errorDetail = errJson?.detail || errJson?.title || errorDetail;
    } catch {}
    throw new MailchimpError(`Failed to retrieve Mailchimp subscriber: ${errorDetail}`, {
      status: response.status,
    });
  }

  const data = (await response.json()) as any;
  return {
    id: data?.id || subscriberHash,
    emailAddress: data?.email_address || email,
    status: data?.status || 'subscribed',
  };
}

/**
 * Checks which Mailchimp environment variables are missing for a target audience.
 */
export function getMissingMailchimpConfig(target: MailchimpTarget = 'subscriber'): string[] {
  const missing: string[] = [];
  if (!process.env.MAILCHIMP_API_KEY?.trim()) {
    missing.push('MAILCHIMP_API_KEY');
  }

  switch (target) {
    case 'subscriber':
      if (
        !process.env.MAILCHIMP_SUBSCRIBER_AUDIENCE_ID?.trim() &&
        !process.env.MAILCHIMP_AUDIENCE_ID?.trim()
      ) {
        missing.push('MAILCHIMP_SUBSCRIBER_AUDIENCE_ID');
      }
      break;
    case 'company':
      if (!process.env.MAILCHIMP_COMPANY_AUDIENCE_ID?.trim()) {
        missing.push('MAILCHIMP_COMPANY_AUDIENCE_ID');
      }
      break;
    case 'investor':
      if (!process.env.MAILCHIMP_INVESTOR_AUDIENCE_ID?.trim()) {
        missing.push('MAILCHIMP_INVESTOR_AUDIENCE_ID');
      }
      break;
    case 'student':
      if (!process.env.MAILCHIMP_STUDENT_AUDIENCE_ID?.trim()) {
        missing.push('MAILCHIMP_STUDENT_AUDIENCE_ID');
      }
      break;
  }

  return missing;
}

