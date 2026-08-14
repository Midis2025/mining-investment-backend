/**
 * Mailchimp Marketing API Service.
 *
 * Handles subscriber synchronization, tagging, and optional Customer Journey triggers.
 * All credentials and audience IDs are resolved server-side from environment variables.
 */

import crypto from 'crypto';

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
 * Resolves Mailchimp configuration from environment variables.
 */
export function getMailchimpConfig(): MailchimpConfig {
  const apiKey = process.env.MAILCHIMP_API_KEY?.trim() || '';
  let serverPrefix = process.env.MAILCHIMP_SERVER_PREFIX?.trim() || '';
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID?.trim() || '';
  const journeyId = process.env.MAILCHIMP_JOURNEY_ID?.trim() || undefined;
  const journeyStepId = process.env.MAILCHIMP_JOURNEY_STEP_ID?.trim() || undefined;
  const defaultTag = process.env.MAILCHIMP_SUBSCRIBER_TAG?.trim() || undefined;

  if (!serverPrefix && apiKey.includes('-')) {
    const parts = apiKey.split('-');
    serverPrefix = parts[parts.length - 1];
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
 * Validates that required Mailchimp credentials are present.
 */
export function validateMailchimpConfig(config: MailchimpConfig): void {
  if (!config.apiKey) {
    throw new MailchimpError('MAILCHIMP_API_KEY is not configured.');
  }
  if (!config.serverPrefix) {
    throw new MailchimpError('MAILCHIMP_SERVER_PREFIX is not configured.');
  }
  if (!config.audienceId) {
    throw new MailchimpError('MAILCHIMP_AUDIENCE_ID is not configured.');
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
 * Adds or updates a subscriber in the Mailchimp Audience using PUT /lists/{list_id}/members/{subscriber_hash}.
 */
export async function addOrUpdateSubscriber(
  input: AddOrUpdateSubscriberInput
): Promise<MailchimpMemberResult> {
  const config = getMailchimpConfig();
  validateMailchimpConfig(config);

  const subscriberHash = getSubscriberHash(input.email);
  const url = `https://${config.serverPrefix}.api.mailchimp.com/3.0/lists/${config.audienceId}/members/${subscriberHash}`;

  const mergeFields: Record<string, string> = {};
  if (input.firstName !== undefined && input.firstName !== null && input.firstName !== '') {
    mergeFields.FNAME = input.firstName.trim();
  }
  if (input.lastName !== undefined && input.lastName !== null && input.lastName !== '') {
    mergeFields.LNAME = input.lastName.trim();
  }

  const payload: Record<string, unknown> = {
    email_address: input.email.trim().toLowerCase(),
    status_if_new: input.statusIfNew || 'subscribed',
  };

  if (Object.keys(mergeFields).length > 0) {
    payload.merge_fields = mergeFields;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: getAuthHeader(config.apiKey),
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
  } else if (config.defaultTag) {
    tagsToAdd.push(config.defaultTag);
  }

  if (tagsToAdd.length > 0) {
    try {
      await addSubscriberTags({
        email: input.email,
        tags: tagsToAdd,
      });
    } catch (tagError) {
      // Non-fatal warning if tag assignment fails
      console.warn('[Mailchimp] Could not apply tags to subscriber:', tagError);
    }
  }

  // Handle optional Customer Journey API trigger
  if (config.journeyId && config.journeyStepId) {
    try {
      await triggerCustomerJourney({
        email: input.email,
        journeyId: config.journeyId,
        stepId: config.journeyStepId,
      });
    } catch (journeyError) {
      console.warn('[Mailchimp] Customer Journey trigger failed:', journeyError);
    }
  }

  return {
    id: responseData.id || subscriberHash,
    emailAddress: responseData.email_address || input.email,
    status: responseData.status || 'subscribed',
  };
}

/**
 * Adds tags to an existing subscriber in Mailchimp.
 */
export async function addSubscriberTags(input: {
  email: string;
  tags: string[];
}): Promise<void> {
  const config = getMailchimpConfig();
  validateMailchimpConfig(config);

  const subscriberHash = getSubscriberHash(input.email);
  const url = `https://${config.serverPrefix}.api.mailchimp.com/3.0/lists/${config.audienceId}/members/${subscriberHash}/tags`;

  const body = {
    tags: input.tags.map((tag) => ({
      name: tag,
      status: 'active',
    })),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeader(config.apiKey),
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
  const config = getMailchimpConfig();
  validateMailchimpConfig(config);

  const url = `https://${config.serverPrefix}.api.mailchimp.com/3.0/customer-journeys/journeys/${input.journeyId}/steps/${input.stepId}/actions/trigger`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeader(config.apiKey),
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
 * Fetches subscriber details from Mailchimp by email.
 */
export async function getSubscriber(email: string): Promise<MailchimpMemberResult | null> {
  const config = getMailchimpConfig();
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
 * Checks which Mailchimp environment variables are missing.
 */
export function getMissingMailchimpConfig(): string[] {
  return ['MAILCHIMP_API_KEY', 'MAILCHIMP_AUDIENCE_ID'].filter(
    (name) => !process.env[name]?.trim()
  );
}
