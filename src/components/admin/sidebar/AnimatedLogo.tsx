"use client";

import { AnimatePresence, motion } from "motion/react";
import WhyteLogo from "@/components/shared/WhyteLogo";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { useCompanyBranding } from "@/components/providers/BrandingProvider";
import { DURATION, EASE, LOGO_DOT_COLOR, LOGO_GEOMETRY } from "./motionTokens";

/**
 * Header logo. A company with its own logo gets that logo (on a light chip, since uploaded logos are usually dark
 * artwork); everyone else, and a logo that fails to load, keeps the animated Whyte wordmark below, unchanged.
 */
export default function AnimatedLogo({ collapsed }: { collapsed: boolean }) {
  const { logoUrl, compactLogoUrl, companyName, settings } = useCompanyBranding();
  if (!logoUrl) return <DefaultWhyteMark collapsed={collapsed} />;
  const wordmark = <CompanyLogo src={logoUrl} name={companyName} variant="header" collapsed={collapsed} settings={settings} fallback={<DefaultWhyteMark collapsed={collapsed} />} />;
  // The rail shows the compact logo when the company supplied one (falling back to the main logo if it fails).
  if (collapsed && compactLogoUrl) {
    return <CompanyLogo src={compactLogoUrl} name={companyName} variant="header" collapsed settings={settings} fallback={wordmark} />;
  }
  return wordmark;
}

/**
 * Header WHYTE logo with a "smart LED" dot.
 *
 * The dot is baked into the PNG, so an overlay of the identical colour sits
 * exactly on top of it (positioned by the measured artwork geometry) and does
 * the breathing — the asset itself is untouched.
 *
 * `collapsed` crossfades the wordmark to just "W" + dot (a crop of the same
 * image). Both layers live in a fixed-width box, so nothing in the header moves.
 */
function DefaultWhyteMark({ collapsed }: { collapsed: boolean }) {
  const fade = { duration: DURATION.base, ease: EASE };

  return (
    <span className="relative inline-flex">
      {/* Full wordmark — also reserves the box size in both modes. */}
      <motion.span
        className="relative inline-flex"
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1 }}
        transition={fade}
      >
        <WhyteLogo theme="dark" alt="Whyte Automations logo" size="header" preload />
        {!collapsed && (
          <span
            aria-hidden="true"
            className="logo-led-dot pointer-events-none absolute top-0 rounded-full"
            style={{
              left: `${LOGO_GEOMETRY.dotLeft * 100}%`,
              width: `${LOGO_GEOMETRY.dotWidth * 100}%`,
              height: `${LOGO_GEOMETRY.dotHeight * 100}%`,
              backgroundColor: LOGO_DOT_COLOR,
            }}
          />
        )}
      </motion.span>

      {/* Collapsed mark: "W" crop + dot, overlaid at the left of the same box. */}
      <AnimatePresence initial={false}>
        {collapsed && (
          <motion.span
            key="w-mark"
            aria-hidden="true"
            // inset-0 = the full logo box, so the % sizes below are fractions of the artwork width.
            className="absolute inset-0 flex items-start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            <span className="relative block h-full shrink-0 overflow-hidden" style={{ width: `${LOGO_GEOMETRY.wordmarkW * 100}%` }}>
              <WhyteLogo theme="dark" alt="" size="header" />
            </span>
            <span
              className="logo-led-dot relative block aspect-square shrink-0 rounded-full"
              style={{
                marginLeft: `${LOGO_GEOMETRY.dotGap * 100}%`,
                width: `${LOGO_GEOMETRY.dotWidth * 100}%`,
                backgroundColor: LOGO_DOT_COLOR,
              }}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
