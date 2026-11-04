/**
 * The premises of a quotation: one of the company's saved premises types (`houseTypeId`, which also brings its template
 * rooms), or a name typed for this quotation only (`premisesName`, e.g. "Farmhouse" or "Dental clinic"). Never both:
 * choosing one clears the other.
 *
 * Pure (no server imports) so the form, the API and the documents share one definition.
 */

/** The select value that stands for "type a custom premises name". */
export const CUSTOM_PREMISES_VALUE = "__custom__";

export const PREMISES_NAME_MAX = 80;

/** The name to show for a quotation's premises, or null when none was chosen. */
export function premisesLabel(quotation: { houseType?: { name?: string | null } | null; premisesName?: string | null }): string | null {
  return quotation.houseType?.name?.trim() || quotation.premisesName?.trim() || null;
}
