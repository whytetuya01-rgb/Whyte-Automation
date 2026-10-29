import { z } from "zod";
import {
  DOCUMENT_LIMITS,
  INTRO_PAGE_MODES,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  isSocialUrl,
  safeHttpsUrl,
  type SocialNetwork,
} from "@/lib/documentSettings";

const noControlChars = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/** Optional single-line text: trimmed, bounded, blank becomes null (meaning "not set"). */
const line = (label: string, max: number) =>
  z
    .string({ message: `${label} must be text.` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => !/[\r\n]/.test(value) && noControlChars(value), `${label} contains invalid characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable();

/** Optional multi-line text (line breaks allowed). */
const paragraph = (label: string, max: number) =>
  z
    .string({ message: `${label} must be text.` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine(noControlChars, `${label} contains invalid characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable();

/** An https URL, stored in its canonical form (`new URL(…).toString()`), so the same link is always saved the same way. */
const httpsUrl = (label: string, max: number) =>
  z
    .string({ message: `${label} must be a web address.` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || safeHttpsUrl(value) !== null, `${label} must start with https://`)
    .transform((value) => (value === null ? null : (safeHttpsUrl(value) as string)))
    .refine((value) => value === null || value.length <= max, `${label} must be ${max} characters or fewer.`)
    .nullable();

const socialField = (network: SocialNetwork) =>
  httpsUrl(`${SOCIAL_LABELS[network]} link`, DOCUMENT_LIMITS.socialUrl).refine(
    (value) => value === null || isSocialUrl(network, value),
    `${SOCIAL_LABELS[network]} link must be an ${SOCIAL_LABELS[network]} address.`
  );

const highlightSchema = z
  .object({
    title: z.string().trim().min(1, "Each highlight needs a title.").max(DOCUMENT_LIMITS.highlightTitle, `A highlight title must be ${DOCUMENT_LIMITS.highlightTitle} characters or fewer.`).refine((v) => !/[\r\n]/.test(v) && noControlChars(v), "A highlight title contains invalid characters."),
    text: z.string().trim().min(1, "Each highlight needs a description.").max(DOCUMENT_LIMITS.highlightText, `A highlight description must be ${DOCUMENT_LIMITS.highlightText} characters or fewer.`).refine(noControlChars, "A highlight description contains invalid characters."),
  })
  .strict();

/**
 * Document content settings. Strict: unknown keys are refused, every URL must be https (and a social link must be
 * on its own network), every text is bounded. Absent key = "not set"; `null` = explicitly cleared.
 */
export const documentSettingsSchema = z
  .object({
    legalName: line("Legal name", DOCUMENT_LIMITS.legalName).optional(),
    website: httpsUrl("Website", DOCUMENT_LIMITS.website).optional(),
    footerText: line("Footer text", DOCUMENT_LIMITS.footerText).optional(),
    automationType: line("Automation type", DOCUMENT_LIMITS.automationType).optional(),
    socialLinks: z
      .object(Object.fromEntries(SOCIAL_NETWORKS.map((network) => [network, socialField(network).optional()])) as Record<SocialNetwork, z.ZodOptional<ReturnType<typeof socialField>>>)
      .strict()
      .optional(),
    introPages: z.enum(INTRO_PAGE_MODES, { message: "Choose standard, custom or none for the introduction pages." }).optional(),
    aboutTitle: line("About title", DOCUMENT_LIMITS.aboutTitle).optional(),
    aboutBody: paragraph("About text", DOCUMENT_LIMITS.aboutBody).optional(),
    aboutHighlights: z.array(highlightSchema).max(DOCUMENT_LIMITS.highlights, `Add at most ${DOCUMENT_LIMITS.highlights} highlights.`).optional(),
  })
  .strict();

export type DocumentSettingsInput = z.infer<typeof documentSettingsSchema>;
