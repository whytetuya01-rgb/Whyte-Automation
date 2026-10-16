import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // `./internal` and `./privileged` are the soft-delete system's escape
  // hatches (raw scope options, Trash access). Only the soft-delete module
  // itself may import them; every other caller goes through `service.ts` /
  // `scope.ts`, which validate the reason before touching either one.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/lib/softDelete/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/softDelete/internal", "**/softDelete/privileged", "**/lib/softDelete/internal", "**/lib/softDelete/privileged"],
              message: "Soft-delete internals are restricted to src/lib/softDelete/**. Use service.ts or scope.ts instead.",
            },
          ],
        },
      ],
    },
  },
  // `./internal` is the tenant-scope system's own escape hatch (the
  // write-authorisation option that lets the migration script set
  // `companyId`). Only the tenant module itself may import it.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/lib/tenant/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/tenant/internal", "**/lib/tenant/internal"],
              message: "Tenant-scope internals are restricted to src/lib/tenant/**. Use context.ts (runUnscoped) instead.",
            },
          ],
        },
      ],
    },
  },
  // `DeletionActor` is a branded type: only `actorFromSession()` may produce
  // one. Forbid casting anything into it from outside the soft-delete module.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/lib/softDelete/**"],
    rules: {
      "@typescript-eslint/no-unsafe-type-assertion": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression[typeAnnotation.typeName.name='DeletionActor']",
          message: "DeletionActor can only be produced by actorFromSession() in src/lib/softDelete/actor.ts.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scratch/**",
    "scripts/**",
    "tests/**",
  ]),
]);

export default eslintConfig;
