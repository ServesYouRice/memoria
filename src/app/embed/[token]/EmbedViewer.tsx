"use client";

import React, { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { Stage } from "react-konva";
import type Konva from "konva";
import type { CanvasItem } from "@/types/canvas";
import { NO_CANVAS_CAPABILITIES } from "@/types/canvas";
import {
  ReadonlyCanvasBackground,
  ReadonlyCanvasItemLayer,
} from "@/features/canvas/components/ReadonlyCanvasItemLayer";
import { CanvasAccessiblePanel } from "@/features/canvas/components/CanvasAccessiblePanel";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

interface EmbedViewerProps {
  name: string;
  zoomLevel: number;
  panX: number;
  panY: number;
  items: CanvasItem[];
}

/** Pan/zoom-only canvas view. No editing, sign-in, or navigation controls. */
export function EmbedViewer({
  name,
  zoomLevel,
  panX,
  panY,
  items,
}: EmbedViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(zoomLevel || 1);
  const [position, setPosition] = useState({ x: panX || 0, y: panY || 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;

    const target = {
      x: (pointer.x - position.x) / zoom,
      y: (pointer.y - position.y) / zoom,
    };
    const next =
      event.evt.deltaY > 0
        ? Math.max(zoom - ZOOM_STEP, MIN_ZOOM)
        : Math.min(zoom + ZOOM_STEP, MAX_ZOOM);
    setZoom(Math.round(next * 100) / 100);
    setPosition({
      x: pointer.x - target.x * next,
      y: pointer.y - target.y * next,
    });
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <CanvasAccessiblePanel
        items={items}
        capabilities={NO_CANVAS_CAPABILITIES}
        canvasName={name}
      />
      <Box
        ref={containerRef}
        sx={{ flex: 1, overflow: "hidden", position: "relative" }}
        role="region"
        aria-label={`${name}, read-only embedded canvas. An equivalent keyboard- and screen-reader-accessible item list is available from the skip control.`}
      >
        {items.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <Typography variant="h6" sx={{ color: "text.secondary" }}>
              This canvas is empty
            </Typography>
          </Box>
        ) : (
          size && (
            <Stage
              width={size.width}
              height={size.height}
              scaleX={zoom}
              scaleY={zoom}
              x={position.x}
              y={position.y}
              draggable
              onDragMove={(event) =>
                setPosition({ x: event.target.x(), y: event.target.y() })
              }
              onDragEnd={(event) =>
                setPosition({ x: event.target.x(), y: event.target.y() })
              }
              onWheel={handleWheel}
            >
              <ReadonlyCanvasBackground
                width={size.width}
                height={size.height}
                zoom={zoom}
                position={position}
              />
              <ReadonlyCanvasItemLayer items={items} />
            </Stage>
          )
        )}
      </Box>
    </Box>
  );
}
