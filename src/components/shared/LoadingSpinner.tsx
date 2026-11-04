/**
 * The loading indicator used across the app: a thin accent arc turning on a soft track. The medium and large ones wait a
 * moment before fading in, so a quick load never flashes a spinner (see "Admin content motion" in globals.css).
 */
export default function LoadingSpinner({ size = "md", label = "Loading" }: { size?: "sm" | "md" | "lg"; label?: string }) {
  const dimension = { sm: 16, md: 30, lg: 44 }[size];
  const stroke = size === "sm" ? 2 : size === "md" ? 2.5 : 3;
  return (
    <div className={size === "sm" ? "inline-flex items-center justify-center" : "flex items-center justify-center p-4"} role="status" aria-label={label}>
      <span className={size === "sm" ? "relative inline-block" : "admin-spinner-delayed relative inline-block"} style={{ width: dimension, height: dimension }}>
        <span className="absolute inset-0 rounded-full border-neutral-200/90" style={{ borderWidth: stroke, borderStyle: "solid" }} />
        <span className="absolute inset-0 animate-spin rounded-full border-transparent border-t-accent" style={{ borderWidth: stroke, borderStyle: "solid", animationDuration: "0.8s" }} />
      </span>
    </div>
  );
}
