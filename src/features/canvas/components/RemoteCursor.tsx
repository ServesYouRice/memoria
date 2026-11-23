"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import {
  collaborationColorForUser,
  cursorIdentityVariant,
} from "@/lib/collaboration/transport-policy";
import { CANVAS_PALETTE } from "@/features/canvas/lib/canvas-palette";
import { prefersReducedMotion } from "@/features/canvas/lib/canvas-motion";

interface RemoteCursorProps {
  userId: string;
  name: string;
  color?: string;
  x: number;
  y: number;
}

const BORDER_STYLES = ["solid", "dashed", "dotted", "double"] as const;
const IDLE_DIM_MS = 8_000;

/**
 * A DOM overlay keeps remote pointers named and present in the a11y tree.
 * Position updates interpolate via rAF + GPU-composited `translate3d` so
 * 10–20 Hz network packets glide smoothly without triggering layout.
 */
export function RemoteCursor({ userId, name, color, x, y }: RemoteCursorProps) {
  const stableColor = color || collaborationColorForUser(userId);
  const variant = cursorIdentityVariant(userId);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef({ x, y });
  const targetRef = useRef({ x, y });
  const rafRef = useRef<number | null>(null);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    targetRef.current = { x, y };
    setIdle(false);
    const idleTimer = window.setTimeout(() => setIdle(true), IDLE_DIM_MS);

    const applyTransform = (posX: number, posY: number) => {
      if (rootRef.current) {
        rootRef.current.style.transform = `translate3d(${posX - 2}px, ${posY - 2}px, 0)`;
      }
    };

    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      currentRef.current = { x, y };
      applyTransform(x, y);
      return () => window.clearTimeout(idleTimer);
    }

    if (rafRef.current === null) {
      let lastTime = performance.now();
      const tick = (now: number) => {
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        const factor = 1 - Math.exp(-18 * dt);
        const cur = currentRef.current;
        const tgt = targetRef.current;
        cur.x += (tgt.x - cur.x) * factor;
        cur.y += (tgt.y - cur.y) * factor;

        if (Math.hypot(tgt.x - cur.x, tgt.y - cur.y) < 0.3) {
          cur.x = tgt.x;
          cur.y = tgt.y;
          applyTransform(cur.x, cur.y);
          rafRef.current = null;
          return;
        }
        applyTransform(cur.x, cur.y);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      window.clearTimeout(idleTimer);
    };
  }, [x, y]);

  useEffect(() => {
    return () => {
      if (
        rafRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <Box
      ref={rootRef}
      role="img"
      aria-label={`${name}'s cursor`}
      data-user-id={userId}
      data-cursor-variant={variant}
      sx={{
        position: "absolute",
        left: 0,
        top: 0,
        zIndex: 900,
        pointerEvents: "none",
        willChange: "transform, opacity",
        transform: `translate3d(${x - 2}px, ${y - 2}px, 0)`,
        opacity: idle ? 0.42 : 1,
        transition: "opacity 400ms ease",
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 18,
          height: 24,
          bgcolor: stableColor,
          clipPath: "polygon(0 0, 100% 70%, 58% 72%, 42% 100%)",
          filter: `drop-shadow(0 1px 2px ${CANVAS_PALETTE.light.shadow})`,
          transform: variant % 2 === 0 ? "none" : "rotate(-3deg)",
          transformOrigin: "top left",
        }}
      />
      <Typography
        aria-hidden="true"
        component="span"
        variant="caption"
        sx={{
          display: "block",
          width: "max-content",
          maxWidth: 180,
          mt: -0.5,
          ml: 1.5,
          px: 0.75,
          py: 0.125,
          border: "2px",
          borderStyle: BORDER_STYLES[variant],
          borderColor: "common.white",
          borderRadius: variant % 2 === 0 ? 1 : 0.25,
          bgcolor: stableColor,
          color: "common.white",
          fontWeight: 700,
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          boxShadow: 1,
        }}
      >
        {name}
      </Typography>
    </Box>
  );
}
