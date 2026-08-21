/**
 * Source website -> Mailchimp tag mapping.
 *
 * One shared Strapi backend serves several event websites. Every registration
 * carries a `sourceWebsite` value describing which site it came from, and that
 * value — nothing else — decides which Mailchimp tag is applied.
 *
 * The tag is what the Mailchimp Automations trigger on, so the audience stays
 * shared per registration category (Investor / Company) while the source tag
 * selects the email template.
 *
 * Deliberately NOT derived from: hostname, referrer, IP, user agent, email
 * domain or route. An unrecognised or missing value yields `null` and no
 * source tag is applied — the registration is still stored and the contact is
 * still synchronised.
 */

/** Canonical source website names, exactly as they must appear as Mailchimp tags. */
export const SOURCE_WEBSITES = {
  miningInvestmentEvent: 'Mining Investment Event',
  internationalMiningWeek: 'International Mining Week',
  nobleMiningInvestmentConference: 'Noble Mining Investment Conference',
} as const;

export type SourceWebsite = (typeof SOURCE_WEBSITES)[keyof typeof SOURCE_WEBSITES];

/** Every tag this backend is allowed to apply as a source tag. */
export const SOURCE_WEBSITE_TAGS: readonly SourceWebsite[] = Object.values(SOURCE_WEBSITES);

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Case, accent and whitespace insensitive folding, mirroring form-validation. */
function foldForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Accepted spellings of each canonical source. Kept intentionally small: these
 * are alternate spellings of an explicitly submitted value, never inferences.
 */
const SOURCE_ALIASES: Readonly<Record<string, SourceWebsite>> = {
  [foldForMatch('Mining Investment Event')]: SOURCE_WEBSITES.miningInvestmentEvent,
  [foldForMatch('THE Mining Investment Event')]: SOURCE_WEBSITES.miningInvestmentEvent,
  [foldForMatch('International Mining Week')]: SOURCE_WEBSITES.internationalMiningWeek,
  [foldForMatch('Noble Mining Investment Conference')]:
    SOURCE_WEBSITES.nobleMiningInvestmentConference,
};

/**
 * Resolves a submitted `sourceWebsite` to its canonical name.
 * Returns `null` when the value is missing, blank or unrecognised.
 */
export function resolveSourceWebsite(raw: unknown): SourceWebsite | null {
  if (typeof raw !== 'string') return null;
  const folded = foldForMatch(raw);
  if (!folded) return null;
  return SOURCE_ALIASES[folded] ?? null;
}

/**
 * Resolves the Mailchimp tag for a submitted `sourceWebsite`.
 *
 * The tag is identical to the canonical source name — the mapping is kept as a
 * separate function so a tag can diverge from a display name later without
 * touching any caller.
 */
export function resolveSourceTag(raw: unknown): SourceWebsite | null {
  return resolveSourceWebsite(raw);
}

/**
 * Appends the source tag to an existing tag list, preserving order and without
 * introducing duplicates. Tags already on the Mailchimp contact are untouched —
 * Mailchimp's tag endpoint only activates the tags it is given.
 */
export function withSourceTag(tags: readonly string[], raw: unknown): string[] {
  const sourceTag = resolveSourceTag(raw);
  if (!sourceTag) return [...tags];
  return tags.includes(sourceTag) ? [...tags] : [...tags, sourceTag];
}
