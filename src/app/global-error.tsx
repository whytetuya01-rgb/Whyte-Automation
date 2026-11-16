"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[GlobalError] Fatal application exception:", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, -apple-system, sans-serif", backgroundColor: "#fafafa" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ maxWidth: "440px", width: "100%", backgroundColor: "#ffffff", borderRadius: "24px", border: "1px solid #e5e5e5", padding: "36px", textAlign: "center", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.05)" }}>
            <div style={{ width: "56px", height: "56px", margin: "0 auto 18px", borderRadius: "16px", backgroundColor: "#fef3c7", color: "#d97706", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>
              ⚠
            </div>
            <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#111827", margin: "0 0 8px" }}>
              System Temporarily Unavailable
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", lineHeight: "1.6", margin: "0 0 24px" }}>
              An unexpected system error occurred. Your workspace data remains securely saved.
            </p>
            {error.digest && (
              <p style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "monospace", margin: "0 0 20px" }}>
                Error Reference: {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={() => reset()}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "12px 24px", borderRadius: "12px", backgroundColor: "#0a0a0a", color: "#ffffff", fontSize: "14px", fontWeight: "500", border: "none", cursor: "pointer", width: "100%" }}
            >
              Reload Application
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

