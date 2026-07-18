"use client";

import { useId } from "react";

export interface MemoriaLogoProps {
  /** Rendered width/height in px. */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Memoria brand mark: a forget-me-not — the flower of remembrance —
 * blooming on a dark gridded canvas. Petals are rounded canvas cards;
 * the amber eye is the memory you keep.
 *
 * Inline SVG so it scales crisply at any size; ids are namespaced with
 * useId so multiple instances can coexist on a page.
 */
export function MemoriaLogo({ size = 32, className, style }: MemoriaLogoProps) {
  const uid = useId();
  const brandId = `${uid}-brand`;
  const gridId = `${uid}-grid`;
  const tileId = `${uid}-tile`;

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, display: "block", ...style }}
      role="img"
      aria-label="Memoria"
    >
      <defs>
        <linearGradient id={brandId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f43f5e" />
          <stop offset="1" stopColor="#be123c" />
        </linearGradient>
        <pattern
          id={gridId}
          x="76"
          y="88"
          width="44"
          height="44"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 44 0 H 0 V 44"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            opacity="0.18"
          />
        </pattern>
        <clipPath id={tileId}>
          <rect width="512" height="512" rx="116" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${tileId})`}>
        <rect width="512" height="512" fill={`url(#${brandId})`} />
        {/* the canvas: dark panel with whitish grid lines */}
        <rect
          x="76"
          y="98"
          width="360"
          height="336"
          rx="28"
          fill="#000000"
          opacity="0.18"
        />
        <rect x="76" y="88" width="360" height="336" rx="28" fill="#1c2452" />
        <rect
          x="76"
          y="88"
          width="360"
          height="336"
          rx="28"
          fill={`url(#${gridId})`}
        />
        <rect
          x="77.5"
          y="89.5"
          width="357"
          height="333"
          rx="26.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          opacity="0.28"
        />
      </g>

      {/* forget-me-not: light-blue canvas-card petals, amber eye */}
      <g transform="translate(256 256) scale(0.78) translate(-256 -256)">
        <g transform="rotate(12 256 256)" fill="#93c5fd">
          <rect x="214" y="136" width="84" height="84" rx="26" />
          <rect
            x="214"
            y="136"
            width="84"
            height="84"
            rx="26"
            transform="rotate(72 256 256)"
          />
          <rect
            x="214"
            y="136"
            width="84"
            height="84"
            rx="26"
            transform="rotate(144 256 256)"
          />
          <rect
            x="214"
            y="136"
            width="84"
            height="84"
            rx="26"
            transform="rotate(216 256 256)"
          />
          <rect
            x="214"
            y="136"
            width="84"
            height="84"
            rx="26"
            transform="rotate(288 256 256)"
          />
        </g>
        <circle cx="256" cy="256" r="34" fill="#fbbf24" />
      </g>
    </svg>
  );
}
