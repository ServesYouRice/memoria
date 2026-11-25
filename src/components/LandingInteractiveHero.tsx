"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { appColor, fonts, motion } from "@/lib/theme";
import { useThemeMode } from "@/lib/theme-context";
import { NOTE_PALETTE } from "@/features/canvas/lib/note-colors";

type CardId = "frame" | "note" | "bookmark" | "poll";

interface Offset {
  x: number;
  y: number;
}

type Offsets = Record<CardId, Offset>;

const INITIAL_OFFSETS: Offsets = {
  frame: { x: 0, y: 0 },
  note: { x: 0, y: 0 },
  bookmark: { x: 0, y: 0 },
  poll: { x: 0, y: 0 },
};

const INITIAL_Z_ORDER: CardId[] = ["frame", "bookmark", "note", "poll"];

const POLL_OPTIONS = [
  { id: "pasteis", label: "Pastéis de Belém", baseVotes: 3 },
  { id: "lxfactory", label: "LX Factory market", baseVotes: 2 },
  { id: "alfama", label: "Alfama tram", baseVotes: 1 },
] as const;

type PollOptionId = (typeof POLL_OPTIONS)[number]["id"];

const KEYBOARD_NUDGE_PX = 12;

export function LandingInteractiveHero() {
  const theme = useTheme();
  const { mode } = useThemeMode();
  const noteColors = NOTE_PALETTE[mode].yellow;

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<CardId, HTMLDivElement | null>>({
    frame: null,
    note: null,
    bookmark: null,
    poll: null,
  });

  const [offsets, setOffsets] = useState<Offsets>(INITIAL_OFFSETS);
  const [zOrder, setZOrder] = useState<CardId[]>(INITIAL_Z_ORDER);
  const [draggingId, setDraggingId] = useState<CardId | null>(null);
  const [votedOption, setVotedOption] = useState<PollOptionId | null>(
    "pasteis",
  );

  const dragStateRef = useRef<{
    id: CardId;
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startOffsetX: number;
    startOffsetY: number;
    minDx: number;
    maxDx: number;
    minDy: number;
    maxDy: number;
    liveX: number;
    liveY: number;
  } | null>(null);

  const hasMoved = (Object.keys(offsets) as CardId[]).some(
    (id) => offsets[id].x !== 0 || offsets[id].y !== 0,
  );

  const bringToFront = useCallback((id: CardId) => {
    setZOrder((prev) =>
      prev[prev.length - 1] === id
        ? prev
        : [...prev.filter((item) => item !== id), id],
    );
  }, []);

  const handleReset = useCallback(() => {
    setOffsets(INITIAL_OFFSETS);
    setZOrder(INITIAL_Z_ORDER);
    setVotedOption("pasteis");
    (Object.keys(cardRefs.current) as CardId[]).forEach((id) => {
      const el = cardRefs.current[id];
      if (el) el.style.transform = "";
    });
  }, []);

  const clampOffset = useCallback(
    (id: CardId, dx: number, dy: number): Offset => {
      const container = containerRef.current;
      const card = cardRefs.current[id];
      if (!container || !card) return { x: dx, y: dy };
      const cRect = container.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      if (cRect.width === 0 && cRect.height === 0) return { x: dx, y: dy };
      const currentOffset = offsets[id];
      const baseLeft = cardRect.left - currentOffset.x - cRect.left;
      const baseTop = cardRect.top - currentOffset.y - cRect.top;
      const minDx = -baseLeft + 8;
      const maxDx = Math.max(
        minDx,
        cRect.width - cardRect.width - baseLeft - 8,
      );
      const minDy = -baseTop + 44;
      const maxDy = Math.max(
        minDy,
        cRect.height - cardRect.height - baseTop - 8,
      );
      return {
        x: Math.min(maxDx, Math.max(minDx, dx)),
        y: Math.min(maxDy, Math.max(minDy, dy)),
      };
    },
    [offsets],
  );

  const handleCardPointerDown = (
    id: CardId,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    const card = cardRefs.current[id];
    if (!container || !card) return;

    e.currentTarget.setPointerCapture?.(e.pointerId);
    bringToFront(id);

    const cRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const current = offsets[id];
    const baseLeft = cardRect.left - current.x - cRect.left;
    const baseTop = cardRect.top - current.y - cRect.top;
    const minDx = -baseLeft + 8;
    const maxDx = Math.max(minDx, cRect.width - cardRect.width - baseLeft - 8);
    const minDy = -baseTop + 44;
    const maxDy = Math.max(minDy, cRect.height - cardRect.height - baseTop - 8);

    dragStateRef.current = {
      id,
      pointerId: e.pointerId,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startOffsetX: current.x,
      startOffsetY: current.y,
      minDx,
      maxDx,
      minDy,
      maxDy,
      liveX: current.x,
      liveY: current.y,
    };
    setDraggingId(id);
  };

  const handleCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const rawX = drag.startOffsetX + (e.clientX - drag.startPointerX);
    const rawY = drag.startOffsetY + (e.clientY - drag.startPointerY);
    const nextX = Math.min(drag.maxDx, Math.max(drag.minDx, rawX));
    const nextY = Math.min(drag.maxDy, Math.max(drag.minDy, rawY));
    drag.liveX = nextX;
    drag.liveY = nextY;
    const el = cardRefs.current[drag.id];
    if (el) {
      el.style.transform = `translate3d(${nextX}px, ${nextY}px, 0) scale(1.02)`;
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const { id, liveX, liveY } = drag;
    dragStateRef.current = null;
    setDraggingId(null);
    setOffsets((prev) => ({
      ...prev,
      [id]: { x: liveX, y: liveY },
    }));
  };

  const handleCardKeyDown = (
    id: CardId,
    e: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (e.target !== e.currentTarget) return;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -KEYBOARD_NUDGE_PX;
    else if (e.key === "ArrowRight") dx = KEYBOARD_NUDGE_PX;
    else if (e.key === "ArrowUp") dy = -KEYBOARD_NUDGE_PX;
    else if (e.key === "ArrowDown") dy = KEYBOARD_NUDGE_PX;
    else return;

    e.preventDefault();
    bringToFront(id);
    setOffsets((prev) => ({
      ...prev,
      [id]: clampOffset(id, prev[id].x + dx, prev[id].y + dy),
    }));
  };

  useEffect(() => {
    (Object.keys(offsets) as CardId[]).forEach((id) => {
      if (draggingId === id) return;
      const el = cardRefs.current[id];
      if (el) {
        el.style.transform = `translate3d(${offsets[id].x}px, ${offsets[id].y}px, 0)`;
      }
    });
  }, [offsets, draggingId]);

  const totalVotes = POLL_OPTIONS.reduce(
    (sum, option) =>
      sum + option.baseVotes + (votedOption === option.id ? 1 : 0),
    0,
  );

  const zIndexFor = (id: CardId) => zOrder.indexOf(id) + 2;

  return (
    <Box
      ref={containerRef}
      role="region"
      aria-label="Interactive Memoria canvas preview"
      sx={{
        position: "relative",
        width: "100%",
        height: { xs: 420, sm: 390, md: 410 },
        bgcolor: appColor("canvasBackground"),
        backgroundImage: `radial-gradient(${appColor("canvasDot")} 1.25px, transparent 1.25px)`,
        backgroundSize: "20px 20px",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Mini floating canvas header bar */}
      <Box
        sx={{
          position: "absolute",
          top: 10,
          left: 10,
          right: 10,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderRadius: 999,
          bgcolor: appColor("floatingSurface"),
          backdropFilter: "blur(10px)",
          border: `1px solid ${appColor("floatingBorder")}`,
          boxShadow: appColor("floatingShadow"),
        }}
      >
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
        >
          <Box
            aria-hidden="true"
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: "success.main",
              flexShrink: 0,
            }}
          />
          <Typography
            variant="caption"
            sx={{
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: "text.primary",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Lisbon Weekend
          </Typography>
          <Typography
            variant="caption"
            sx={{
              display: { xs: "none", sm: "inline" },
              color: "text.secondary",
              whiteSpace: "nowrap",
            }}
          >
            · Drag cards or vote
          </Typography>
        </Box>

        <Button
          size="small"
          variant="text"
          onClick={handleReset}
          disabled={!hasMoved && votedOption === "pasteis"}
          aria-label="Reset preview layout"
          sx={{
            minHeight: 26,
            px: 1.25,
            py: 0.25,
            fontSize: "0.75rem",
            borderRadius: 999,
            flexShrink: 0,
          }}
        >
          Reset
        </Button>
      </Box>

      {/* Titled Frame */}
      <Box
        ref={(el: HTMLDivElement | null) => {
          cardRefs.current.frame = el;
        }}
        role="group"
        aria-label="Draggable section frame: Itinerary and spots"
        tabIndex={0}
        onPointerDown={(e) => handleCardPointerDown("frame", e)}
        onPointerMove={handleCardPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(e) => handleCardKeyDown("frame", e)}
        sx={{
          position: "absolute",
          top: { xs: 78, sm: 84 },
          left: { xs: 12, sm: 20 },
          width: { xs: "calc(100% - 24px)", sm: "62%" },
          height: { xs: 200, sm: 286 },
          zIndex: zIndexFor("frame"),
          borderRadius: 3,
          bgcolor: alpha(theme.palette.background.paper, 0.48),
          border: "1.5px solid",
          borderColor:
            draggingId === "frame" ? "primary.main" : appColor("border"),
          cursor: draggingId === "frame" ? "grabbing" : "grab",
          touchAction: "none",
          transition:
            draggingId === "frame"
              ? "border-color 120ms ease"
              : `transform 260ms ${motion.springGentle}, border-color 120ms ease`,
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
          },
        }}
      >
        {/* Top-left floating pill tab */}
        <Box
          sx={{
            position: "absolute",
            top: -15,
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.25,
            py: 0.375,
            borderRadius: 999,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: 1,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: "text.primary",
              lineHeight: 1.2,
            }}
          >
            Itinerary &amp; spots
          </Typography>
          <Typography
            variant="caption"
            sx={{
              px: 0.75,
              py: 0.125,
              borderRadius: 999,
              bgcolor: "action.selected",
              color: "text.primary",
              fontWeight: 700,
              fontSize: "0.6875rem",
              lineHeight: 1.2,
            }}
          >
            3
          </Typography>
        </Box>
      </Box>

      {/* Sticky Note Card */}
      <Box
        ref={(el: HTMLDivElement | null) => {
          cardRefs.current.note = el;
        }}
        role="group"
        aria-label="Draggable sticky note card"
        tabIndex={0}
        onPointerDown={(e) => handleCardPointerDown("note", e)}
        onPointerMove={handleCardPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(e) => handleCardKeyDown("note", e)}
        sx={{
          position: "absolute",
          top: { xs: 100, sm: 110 },
          left: { xs: 20, sm: 34 },
          width: { xs: 158, sm: 186 },
          p: 1.75,
          borderRadius: 2.5,
          zIndex: zIndexFor("note"),
          bgcolor: noteColors.fill,
          color: noteColors.text,
          border: "1px solid",
          borderColor:
            draggingId === "note" ? "primary.main" : noteColors.stroke,
          boxShadow:
            draggingId === "note"
              ? theme.shadows[6]
              : appColor("cardHoverShadow"),
          cursor: draggingId === "note" ? "grabbing" : "grab",
          touchAction: "none",
          transition:
            draggingId === "note"
              ? "box-shadow 120ms ease"
              : `transform 260ms ${motion.springGentle}, box-shadow 180ms ease`,
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            display: "block",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontSize: "0.65rem",
            opacity: 0.8,
            mb: 0.5,
          }}
        >
          Note
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            lineHeight: 1.4,
            fontSize: { xs: "0.8rem", sm: "0.85rem" },
          }}
        >
          Catch golden hour at Miradouro da Graça before dinner
        </Typography>
      </Box>

      {/* Paper Bookmark Card */}
      <Box
        ref={(el: HTMLDivElement | null) => {
          cardRefs.current.bookmark = el;
        }}
        role="group"
        aria-label="Draggable bookmark card: Belém Tower"
        tabIndex={0}
        onPointerDown={(e) => handleCardPointerDown("bookmark", e)}
        onPointerMove={handleCardPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(e) => handleCardKeyDown("bookmark", e)}
        sx={{
          position: "absolute",
          top: { xs: 108, sm: 220 },
          right: { xs: 14, sm: "auto" },
          left: { xs: "auto", sm: 120 },
          width: { xs: 152, sm: 215 },
          borderRadius: 2.5,
          overflow: "hidden",
          zIndex: zIndexFor("bookmark"),
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: draggingId === "bookmark" ? "primary.main" : "divider",
          boxShadow:
            draggingId === "bookmark"
              ? theme.shadows[6]
              : appColor("cardHoverShadow"),
          cursor: draggingId === "bookmark" ? "grabbing" : "grab",
          touchAction: "none",
          transition:
            draggingId === "bookmark"
              ? "box-shadow 120ms ease"
              : `transform 260ms ${motion.springGentle}, box-shadow 180ms ease`,
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
          },
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: 14,
                height: 14,
                borderRadius: 1,
                bgcolor: alpha(theme.palette.primary.main, 0.14),
                border: "1px solid",
                borderColor: alpha(theme.palette.primary.main, 0.35),
                flexShrink: 0,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                color: "primary.main",
                fontWeight: 600,
                fontSize: "0.7rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              belem-tower.pt
            </Typography>
          </Box>
          <Typography
            variant="subtitle2"
            sx={{
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: "text.primary",
              lineHeight: 1.25,
              mb: 0.5,
              fontSize: { xs: "0.8rem", sm: "0.875rem" },
            }}
          >
            Belém Tower &amp; Riverfront
          </Typography>
          <Typography
            variant="caption"
            sx={{
              display: { xs: "none", sm: "-webkit-box" },
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              color: "text.secondary",
              lineHeight: 1.35,
            }}
          >
            16th-century landmark on the Tagus · Open until 18:30
          </Typography>
        </Box>
      </Box>

      {/* Live Interactive Poll Card */}
      <Box
        ref={(el: HTMLDivElement | null) => {
          cardRefs.current.poll = el;
        }}
        role="group"
        aria-label="Draggable live poll card: Saturday morning"
        tabIndex={0}
        onPointerDown={(e) => handleCardPointerDown("poll", e)}
        onPointerMove={handleCardPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(e) => handleCardKeyDown("poll", e)}
        sx={{
          position: "absolute",
          bottom: { xs: 14, sm: "auto" },
          top: { xs: "auto", sm: 92 },
          right: { xs: 14, sm: 20 },
          width: { xs: "calc(100% - 28px)", sm: 214 },
          p: 1.5,
          borderRadius: 2.5,
          zIndex: zIndexFor("poll"),
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: draggingId === "poll" ? "primary.main" : "divider",
          boxShadow:
            draggingId === "poll"
              ? theme.shadows[6]
              : appColor("floatingShadow"),
          cursor: draggingId === "poll" ? "grabbing" : "grab",
          touchAction: "none",
          transition:
            draggingId === "poll"
              ? "box-shadow 120ms ease"
              : `transform 260ms ${motion.springGentle}, box-shadow 180ms ease`,
          "@media (prefers-reduced-motion: reduce)": {
            transition: "none",
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1,
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontFamily: fonts.heading,
              fontWeight: 700,
              color: "text.primary",
              fontSize: "0.85rem",
            }}
          >
            Saturday morning?
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontSize: "0.7rem" }}
          >
            {totalVotes} votes
          </Typography>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {POLL_OPTIONS.map((option) => {
            const selected = votedOption === option.id;
            const count = option.baseVotes + (selected ? 1 : 0);
            const pct =
              totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

            return (
              <Box
                key={option.id}
                component="button"
                type="button"
                aria-pressed={selected}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setVotedOption((prev) =>
                    prev === option.id ? null : option.id,
                  );
                }}
                sx={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  px: 1.25,
                  py: 0.625,
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: "background.default",
                  color: "text.primary",
                  fontFamily: "inherit",
                  fontSize: "0.75rem",
                  fontWeight: selected ? 700 : 500,
                  textAlign: "left",
                  cursor: "pointer",
                  transition: `border-color 150ms ${motion.easeOut}`,
                  "&:hover": {
                    borderColor: "primary.main",
                  },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct}%`,
                    bgcolor: alpha(
                      theme.palette.primary.main,
                      selected ? 0.18 : 0.08,
                    ),
                    transition: `width 280ms ${motion.springGentle}`,
                    "@media (prefers-reduced-motion: reduce)": {
                      transition: "none",
                    },
                  }}
                />
                <Box component="span" sx={{ position: "relative", zIndex: 1 }}>
                  {option.label}
                </Box>
                <Box
                  component="span"
                  sx={{
                    position: "relative",
                    zIndex: 1,
                    color: selected ? "primary.main" : "text.secondary",
                    fontWeight: 700,
                    ml: 1,
                  }}
                >
                  {pct}%
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Subtle ambient collaborator cursor */}
      <Box
        aria-hidden="true"
        sx={{
          position: "absolute",
          left: { xs: "52%", sm: "56%" },
          top: { xs: "36%", sm: "66%" },
          zIndex: 18,
          pointerEvents: "none",
          "@keyframes heroCursorDrift": {
            "0%, 100%": { transform: "translate3d(0px, 0px, 0)" },
            "50%": { transform: "translate3d(26px, -18px, 0)" },
          },
          animation: `heroCursorDrift 6.5s ${motion.springGentle} infinite`,
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
          },
        }}
      >
        <Box
          sx={{
            width: 14,
            height: 18,
            bgcolor: "primary.main",
            clipPath: "polygon(0 0, 100% 70%, 58% 72%, 42% 100%)",
          }}
        />
        <Typography
          component="span"
          variant="caption"
          sx={{
            display: "inline-block",
            mt: -0.5,
            ml: 1.25,
            px: 0.75,
            py: 0.125,
            borderRadius: 1,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            fontWeight: 700,
            fontSize: "0.6875rem",
            lineHeight: 1.3,
            boxShadow: 1,
          }}
        >
          Maya
        </Typography>
      </Box>
    </Box>
  );
}
