/**
 * Slug of the single default company (the existing Company id 1,
 * "Whyte Automations"). Used by public registration, the counter bootstrap and
 * the tenant backfill planner so they can never disagree about which company
 * is "the default". There is deliberately no implicit fallback to company id 1.
 */
export const DEFAULT_COMPANY_SLUG = "whyte-automations";
