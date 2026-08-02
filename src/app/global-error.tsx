"use client";

/**
 * Global error boundary.
 *
 * Replaces the root layout when rendering fails above `app/error.tsx`, so it
 * cannot rely on the theme, MUI, or any provider. Everything here is inline and
 * dependency-free, and the copy makes no claim about what was saved.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: "#fafafa",
          color: "#1a1a1a",
        }}
      >
        <main style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
            Memoria could not load
          </h1>
          <p style={{ lineHeight: 1.7, color: "#555" }}>
            The application failed to start. Any changes that had not finished
            saving may not have been stored. Reloading is safe to try.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#777",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              marginTop: "24px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: "#1a1a1a",
                color: "#fff",
                fontSize: "0.9375rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A plain anchor is deliberate: this boundary replaces
                            the root layout, so a full document load is the only
                            reliable way back to a working app. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "1px solid #ccc",
                color: "inherit",
                fontSize: "0.9375rem",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
