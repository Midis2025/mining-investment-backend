/**
 * Synchronizes Noble investor registrations with the existing shared
 * Mailchimp Investor Registration Audience and applies the tag for the
 * website the registration came from (`sourceWebsite`).
 *
 * No email is sent from here — the Mailchimp Automation listening for the
 * source tag sends the template. Resend is not involved in this flow.
 */

import {
  syncRegistrationMailchimpOnCreate,
  type RegistrationLifecycleEvent,
} from '../../../../utils/registration-mailchimp';

export default {
  afterCreate(event: RegistrationLifecycleEvent) {
    syncRegistrationMailchimpOnCreate('noble-investor', event);
  },
};
