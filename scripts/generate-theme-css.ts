/**
 * Writes src/app/theme-presets.css from the preset palettes in src/lib/themeTokens.ts. Run it after changing a preset:
 *
 *   npx ts-node -T -P tsconfig.testrun.json -r tsconfig-paths/register scripts/generate-theme-css.ts
 *
 * tests/theme-presets.test.ts fails while the checked-in file and the palettes disagree.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildThemePresetCss } from "../src/lib/themeTokens";

const target = join(__dirname, "..", "src", "app", "theme-presets.css");
writeFileSync(target, buildThemePresetCss(), "utf8");
console.log(`Wrote ${target}`);
