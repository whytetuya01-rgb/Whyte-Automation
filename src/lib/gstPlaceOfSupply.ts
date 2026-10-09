/**
 * Determines whether a quotation's tax should be shown as CGST+SGST
 * (intra-state) or IGST (inter-state), per place-of-supply rules.
 *
 * This is purely a DISPLAY/labelling decision for the proposal PDF — it
 * never changes the total GST amount, which stays authoritatively computed
 * by `calculateQuotationGst` in `src/lib/pricing.ts` (18% either way; only
 * whether it's shown as one IGST line or split into two 9% lines differs).
 */
import { isValidGstin, normalizeGstin } from "@/lib/validation/fields";

/** Whyte Automations' registered home state (Gandhinagar, Gujarat), used only
 *  when the Company record's own GSTIN is missing/invalid. */
export const SUPPLIER_HOME_STATE_CODE = "24";

/** GST state/UT codes, by their commonly used full name (lowercase) — only
 *  the states/UTs that are realistically a quotation's billing address need
 *  to be covered here; this is a best-effort text match over free-form
 *  address input, not a substitute for a structured state field. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", punjab: "03", chandigarh: "04",
  uttarakhand: "05", haryana: "06", delhi: "07", rajasthan: "08", "uttar pradesh": "09",
  bihar: "10", sikkim: "11", "arunachal pradesh": "12", nagaland: "13", manipur: "14",
  mizoram: "15", tripura: "16", meghalaya: "17", assam: "18", "west bengal": "19",
  jharkhand: "20", odisha: "21", orissa: "21", chhattisgarh: "22", "madhya pradesh": "23",
  gujarat: "24", "daman and diu": "25", "dadra and nagar haveli": "26", maharashtra: "27",
  karnataka: "29", goa: "30", lakshadweep: "31", kerala: "32", "tamil nadu": "33",
  puducherry: "34", "andaman and nicobar": "35", telangana: "36", "andhra pradesh": "37",
  ladakh: "38",
};

function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!gstin || !isValidGstin(gstin)) return null;
  return normalizeGstin(gstin).slice(0, 2);
}

/** Best-effort: looks for a known Indian state/UT name inside free-text address. */
function stateCodeFromAddressText(address: string | null | undefined): string | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

export interface PlaceOfSupplyResult {
  /** "intra" -> CGST+SGST, "inter" -> IGST. Defaults to "intra" (today's
   *  existing behavior) whenever the client's state can't be determined —
   *  the safer default, since we never want to silently apply the wrong
   *  split without positive evidence of a different state. */
  type: "intra" | "inter";
  supplierStateCode: string;
  clientStateCode: string | null;
}

export function resolvePlaceOfSupply(params: {
  supplierGstin?: string | null;
  clientGstin?: string | null;
  clientAddress?: string | null;
}): PlaceOfSupplyResult {
  const supplierStateCode = gstinStateCode(params.supplierGstin) || SUPPLIER_HOME_STATE_CODE;
  const clientStateCode =
    gstinStateCode(params.clientGstin) || stateCodeFromAddressText(params.clientAddress);

  const type: PlaceOfSupplyResult["type"] =
    clientStateCode && clientStateCode !== supplierStateCode ? "inter" : "intra";

  return { type, supplierStateCode, clientStateCode };
}
