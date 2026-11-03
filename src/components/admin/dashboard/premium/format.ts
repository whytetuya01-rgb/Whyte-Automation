/** Short rupee amounts for charts and headline numbers: 1,20,000 -> ₹1.2L, 2,50,00,000 -> ₹2.5Cr. */
export function compactINR(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "₹0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export const percent = (n: number): string => `${Math.round(n * 10) / 10}%`;

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
