# Whyte Platform Upgrade — Pricing Engine + Layout Redesign

> **Full detailed plan:** See the implementation_plan.md artifact in Antigravity.
> This is a condensed project-root reference copy.

---

## CRITICAL: Schema Drift Detected

The `schema.prisma` file is **stale** — it's missing `ProductVariant` model, `Product.moduleSize`, `Category.variantTiers/variantFinishes`, `Quotation.defaultTier/defaultFinish`, `QuotationItem.productVariantId/variantLabel`. These exist in the running DB (used by seed + API) but were never added to schema.prisma or Prisma migrations.

**Must fix first:** Sync schema.prisma → baseline → then add matrix fields.

---

## Part 1: Matrix Pricing Engine

**Goal:** Generalize hardcoded `automationTier × surfaceFinish` to N-dimensional JSONB `config`.

- `Product` gets: `isMatrix` boolean + `matrixDimensions` JSONB
- `ProductVariant` gets: `config` JSONB (e.g. `{"series":"wifi","finish":"glass"}`)
- `QuotationItem` gets: `variantConfig` JSONB snapshot
- Old columns (`automationTier`, `surfaceFinish`) stay until validated
- Flat products: `isMatrix=false`, single variant, no picker
- Matrix products: interactive grid/list picker, unavailable combos greyed out
- Line items always snapshot price + config + label (immutable)

## Part 2: Layout Redesign

**Goal:** Reclaim ~30% more product grid space, improve mobile UX.

- Summary panel (w-80, 20% of screen) → sticky bottom bar + slide-up sheet
- Room notes → moved to Items tab (not shown during product browsing)
- Rooms sidebar → collapsible (w-56, toggle to icons-only)
- Mobile → horizontal room pills + sticky footer + bottom sheet summary
- Product grid gains: ~45% more width + ~100px more height

## 12 Pre-Discovered Problems

All documented with fixes in the full plan. Key ones:
1. Schema.prisma stale → sync + baseline first
2. ProductVariant type missing from types/index.ts
3. ProductForm sends flat price, API expects variants[]
4. FK cascade issue when variants replaced
5. PDF doesn't show variant labels
6. VariantPicker assumes exactly 2 dimensions

## Execution: 6 phases, 24 file changes, 11 manual test cases.
