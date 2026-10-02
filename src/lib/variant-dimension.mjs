export function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function buildVariantLabel(variant, config) {
  if (variant.automationTier && variant.surfaceFinish) {
    return `${capitalize(variant.automationTier)} + ${capitalize(variant.surfaceFinish)}`;
  }
  if (variant.automationTier) {
    return capitalize(variant.automationTier);
  }
  if (variant.surfaceFinish) {
    return capitalize(variant.surfaceFinish);
  }

  const effectiveConfig = config ?? variant.config ?? {};
  const meaningfulParts = Object.entries(effectiveConfig)
    .filter(([k, v]) => !/^(variantcode|code|id|name)$/i.test(k) && Boolean(v))
    .map(([, v]) => capitalize(String(v)));

  if (meaningfulParts.length > 0) {
    return meaningfulParts.join(" + ");
  }

  return variant.name || variant.code || "Standard";
}

export function normalizeProductDimensions(product, variants) {
  const rawDims = product?.matrixDimensions;

  if (Array.isArray(rawDims) && rawDims.length > 0) {
    const parsed = [];

    for (const raw of rawDims) {
      if (!raw || typeof raw !== "object") continue;

      const rawOptions = Array.isArray(raw.options)
        ? raw.options
        : Array.isArray(raw.values)
        ? raw.values
        : [];

      const cleanOptions = Array.from(
        new Set(
          rawOptions
            .map((opt) => (opt !== null && opt !== undefined ? String(opt).trim() : ""))
            .filter((opt) => opt.length > 0)
        )
      );

      const label = String(raw.label || raw.name || raw.key || "Option").trim();
      let key = String(raw.key || "").trim().toLowerCase();

      if (!key) {
        if (/automation|series|tier/i.test(label)) key = "series";
        else if (/finish|surface/i.test(label)) key = "finish";
        else key = label.toLowerCase().replace(/[^a-z0-9]/g, "_");
      }

      if (cleanOptions.length > 0) {
        parsed.push({
          key,
          label,
          options: cleanOptions,
        });
      }
    }

    if (parsed.length > 0) {
      return parsed;
    }
  }

  // Fallback: Dynamically derive dimensions from active variants
  if (variants && variants.length > 1) {
    const tiers = new Set();
    const finishes = new Set();

    for (const v of variants) {
      const conf = v.config || {};
      const t = v.automationTier || conf.series || conf.tier || conf.automationTier;
      const f = v.surfaceFinish || conf.finish || conf.surfaceFinish;

      if (t && typeof t === "string") tiers.add(t.trim());
      if (f && typeof f === "string") finishes.add(f.trim());
    }

    const derived = [];
    if (tiers.size > 0) {
      derived.push({
        key: "series",
        label: "Automation Tier",
        options: Array.from(tiers),
      });
    }
    if (finishes.size > 0) {
      derived.push({
        key: "finish",
        label: "Surface Finish",
        options: Array.from(finishes),
      });
    }

    if (derived.length > 0) {
      return derived;
    }
  }

  return [];
}

export function findVariant(variants, config) {
  const configEntries = Object.entries(config).filter(([, v]) => Boolean(v));
  if (configEntries.length === 0) return variants[0];

  return variants.find((v) => {
    const vc = v.config ?? {};

    return configEntries.every(([key, expectedVal]) => {
      const exp = String(expectedVal).trim().toLowerCase();
      if (!exp) return true;

      // 1. Exact match in v.config
      if (vc[key] && String(vc[key]).trim().toLowerCase() === exp) {
        return true;
      }

      // 2. Automation Tier / Series aliases
      const isTier = /^(series|tier|automationtier|automation)$/i.test(key);
      if (isTier) {
        if (v.automationTier && v.automationTier.trim().toLowerCase() === exp) return true;
        if (vc.series && String(vc.series).trim().toLowerCase() === exp) return true;
        if (vc.tier && String(vc.tier).trim().toLowerCase() === exp) return true;
        if (vc.automationTier && String(vc.automationTier).trim().toLowerCase() === exp) return true;
      }

      // 3. Surface Finish aliases
      const isFinish = /^(finish|surfacefinish|surface)$/i.test(key);
      if (isFinish) {
        if (v.surfaceFinish && v.surfaceFinish.trim().toLowerCase() === exp) return true;
        if (vc.finish && String(vc.finish).trim().toLowerCase() === exp) return true;
        if (vc.surfaceFinish && String(vc.surfaceFinish).trim().toLowerCase() === exp) return true;
      }

      // 4. Case-insensitive key match in v.config
      for (const [k, val] of Object.entries(vc)) {
        if (k.toLowerCase() === key.toLowerCase() && String(val).trim().toLowerCase() === exp) {
          return true;
        }
      }

      return false;
    });
  });
}
