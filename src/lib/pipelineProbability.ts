/**
 * Win probability on the sales pipeline. Every stage has a default chance of closing; a salesperson can override it on a
 * lead ("this one is nearly certain") and the override lasts until the lead moves to another stage. Won is always 100%
 * and lost always 0%. The expected (weighted) value of a deal is its value times its probability.
 *
 * Pure (no server imports) so the board, the lead form, the API and the tests share one definition.
 */
import type { LeadStatus } from "@/types/crm";

export const STAGE_PROBABILITY: Readonly<Record<LeadStatus, number>> = {
  new: 10,
  contacted: 25,
  site_visit: 40,
  quoted: 60,
  negotiation: 80,
  won: 100,
  lost: 0,
};

/** The stages whose default chance a company may set. Won is always 100% and lost always 0%. */
export const CONFIGURABLE_PROBABILITY_STAGES = ["new", "contacted", "site_visit", "quoted", "negotiation"] as const;
export type ConfigurableProbabilityStage = (typeof CONFIGURABLE_PROBABILITY_STAGES)[number];

/**
 * The stage defaults a company is using: its own saved percentages, and the built-in default for any stage it has not
 * set (or whose saved value is not a whole number from 0 to 100). Used ONLY to forecast the pipeline: it never touches a
 * quotation total or revenue.
 */
export function resolveStageProbabilities(custom?: Partial<Record<string, unknown>> | null): Record<LeadStatus, number> {
  const resolved: Record<LeadStatus, number> = { ...STAGE_PROBABILITY };
  for (const stage of CONFIGURABLE_PROBABILITY_STAGES) {
    const value = clampProbability(custom?.[stage]);
    if (value !== null) resolved[stage] = value;
  }
  return resolved;
}

/** Only the Company Owner, an Admin, or a custom-role admin who manages the CRM may change the stage probabilities. */
export function canConfigureStageProbabilities(role: string | null | undefined, permissions: readonly string[] = []): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  if (normalized === "company_owner" || normalized === "admin") return true;
  return normalized === "configurable_admin" && permissions.includes("crm:manage");
}

/** A whole number from 0 to 100, or null when the value is not one (so "no override"). */
export function clampProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const whole = Math.round(value);
  return whole < 0 || whole > 100 ? null : whole;
}

/** The chance this deal closes: won 100, lost 0, otherwise the lead's own override or its stage's default. */
export function effectiveProbability(
  status: LeadStatus,
  override?: number | null,
  stageDefaults: Readonly<Record<LeadStatus, number>> = STAGE_PROBABILITY
): number {
  if (status === "won") return 100;
  if (status === "lost") return 0;
  return clampProbability(override) ?? stageDefaults[status] ?? STAGE_PROBABILITY[status] ?? 0;
}

/** Value times probability, to the rupee. */
export function weightedValue(value: number, probability: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount * probability) / 100);
}

/** A colour band for showing a probability: strong, middling, weak. */
export function probabilityTone(probability: number): "high" | "medium" | "low" {
  return probability >= 70 ? "high" : probability >= 35 ? "medium" : "low";
}
