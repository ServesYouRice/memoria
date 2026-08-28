/**
 * Public Canvas Share Page
 * View a publicly shared canvas without authentication
 */

"use client";

import React, { useState, useEffect, useRef, use } from "react";
import {
  Box,
  CircularProgress,
  Alert,
  Typography,
  Button,
  AppBar,
  Toolbar,
  ButtonGroup,
  Tooltip,
} from "@mui/material";
import { ZoomIn, ZoomOut, FitScreen } from "@mui/icons-material";
import { Stage } from "react-konva";
import Link from "next/link";
import { type CanvasItem } from "@/types/canvas";
import type Konva from "konva";
import { ReadonlyCanvasItemLayer } from "@/features/canvas/components/ReadonlyCanvasItemLayer";
import { CanvasAccessiblePanel } from "@/features/canvas/components/CanvasAccessiblePanel";
import { NO_CANVAS_CAPABILITIES } from "@/types/canvas";
import {
  publicCanvasShareResponseSchema,
  type PublicCanvasShareResponse,
} from "@/lib/api/response-schemas";

interface SharePageProps {
  params: Promise<{
    token: string;
  }>;
}

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export default function SharePage({ params }: SharePageProps) {
  const { token } = use(params);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<
    PublicCanvasShareResponse["canvas"] | null
  >(null);
  const [items, setItems] = useState<CanvasItem[]>([]);

  // Canvas state
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch canvas data and follow continuation until completeness contract is met
  useEffect(() => {
    let active = true;

    const fetchCanvas = async () => {
      try {
        const response = await fetch(`/api/v1/share/${token}`);

        if (!response.ok) {
          if (response.status === 404) {
            if (active) setError("Canvas not found or link has expired");
          } else if (response.status === 403) {
            if (active) setError("This canvas is no longer publicly shared");
          } else {
            if (active) setError("Failed to load canvas");
          }
          if (active) setLoading(false);
          return;
        }

        const rawData = await response.json();
        const data = publicCanvasShareResponseSchema.parse(rawData);

        if (!active) return;

        setCanvas(data.canvas);
        setZoom(data.canvas.zoomLevel || 1);
        setPosition({ x: data.canvas.panX || 0, y: data.canvas.panY || 0 });

        const allItems: CanvasItem[] = [
          ...(data.items as unknown as CanvasItem[]),
        ];
        let hasMore = data.hasMore;
        let nextCursor = data.nextCursor;
        let pageCount = 1;

        while (hasMore && pageCount < 100) {
          const nextUrl = nextCursor
            ? `/api/v1/share/${token}?cursor=${encodeURIComponent(nextCursor)}`
            : `/api/v1/share/${token}?offset=${allItems.length}`;
          const pageResponse = await fetch(nextUrl);
          if (!pageResponse.ok) {
            throw new Error("Failed to load additional canvas items");
          }
          const nextRaw = await pageResponse.json();
          const nextPage = publicCanvasShareResponseSchema.parse(nextRaw);

          if (nextPage.items.length === 0) break;

          allItems.push(...(nextPage.items as unknown as CanvasItem[]));
          hasMore = nextPage.hasMore;
          nextCursor = nextPage.nextCursor;
          pageCount++;
        }

        if (active) {
          setItems(allItems);
        }
      } catch {
        if (active) setError("Failed to load canvas");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchCanvas();

    return () => {
      active = false;
    };
  }, [token]);

  // Update stage size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const handleZoomIn = () => {
    const newZoom = Math.min(zoom + ZOOM_STEP, MAX_ZOOM);
    setZoom(Math.round(newZoom * 100) / 100);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - ZOOM_STEP, MIN_ZOOM);
    setZoom(Math.round(newZoom * 100) / 100);
  };

  const handleFitToScreen = () => {
    if (items.length === 0 || !stageRef.current) return;

    // Calculate bounding box of all items
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    items.forEach((item) => {
      minX = Math.min(minX, item.positionX);
      minY = Math.min(minY, item.positionY);
      maxX = Math.max(maxX, item.positionX + item.width);
      maxY = Math.max(maxY, item.positionY + item.height);
    });

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = 50;

    // Calculate zoom to fit
    const scaleX = (stageSize.width - padding * 2) / contentWidth;
    const scaleY = (stageSize.height - padding * 2) / contentHeight;
    const newZoom = Math.min(scaleX, scaleY, MAX_ZOOM);

    // Center content
    const newX =
      (stageSize.width - contentWidth * newZoom) / 2 - minX * newZoom;
    const newY =
      (stageSize.height - contentHeight * newZoom) / 2 - minY * newZoom;

    setZoom(Math.round(newZoom * 100) / 100);
    setPosition({ x: newX, y: newY });
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - position.x) / oldScale,
      y: (pointer.y - position.y) / oldScale,
    };

    const newScale =
      e.evt.deltaY > 0
        ? Math.max(oldScale - ZOOM_STEP, MIN_ZOOM)
        : Math.min(oldScale + ZOOM_STEP, MAX_ZOOM);

    setZoom(Math.round(newScale * 100) / 100);
    setPosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          p: 4,
        }}
      >
        <Alert severity="error" sx={{ mb: 2, maxWidth: 500 }}>
          {error}
        </Alert>
        <Button component={Link} href="/" variant="contained">
          Go to Home
        </Button>
      </Box>
    );
  }

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
      <AppBar position="static" color="default" elevation={1}>
        {/* Wraps rather than overflowing at 320/375px. */}
        <Toolbar sx={{ flexWrap: "wrap", rowGap: 1, py: { xs: 1, sm: 0 } }}>
          <Typography
            variant="h6"
            component="div"
            sx={{ flexGrow: 1, minWidth: 0, mr: 1 }}
          >
            {canvas?.name || "Shared Canvas"}{" "}
            <Typography
              component="span"
              variant="caption"
              sx={{
                color: "text.secondary",
              }}
            >
              (Read Only)
            </Typography>
          </Typography>

          {/* Zoom Controls */}
          <Box sx={{ display: "flex", alignItems: "center", mr: 2 }}>
            <ButtonGroup variant="outlined" size="small" sx={{ mr: 1 }}>
              <Tooltip title="Zoom Out">
                <Button onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM}>
                  <ZoomOut />
                </Button>
              </Tooltip>
              <Tooltip title="Fit to Screen">
                <Button onClick={handleFitToScreen}>
                  <FitScreen />
                </Button>
              </Tooltip>
              <Tooltip title="Zoom In">
                <Button onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM}>
                  <ZoomIn />
                </Button>
              </Tooltip>
            </ButtonGroup>
            <Typography
              variant="body2"
              sx={{
                minWidth: 50,
                textAlign: "center",
                display: { xs: "none", sm: "block" },
              }}
            >
              {Math.round(zoom * 100)}%
            </Typography>
          </Box>

          <Button
            component={Link}
            href="/auth/login"
            variant="outlined"
            sx={{ mr: 1 }}
          >
            Sign In
          </Button>
          <Button component={Link} href="/auth/register" variant="contained">
            Sign Up
          </Button>
        </Toolbar>
      </AppBar>

      <CanvasAccessiblePanel
        items={items}
        capabilities={NO_CANVAS_CAPABILITIES}
        canvasName={canvas?.name || "Shared canvas"}
      />

      {/* Canvas */}
      <Box
        ref={containerRef}
        sx={{ flex: 1, overflow: "hidden", position: "relative" }}
        role="region"
        aria-label="Shared canvas. An equivalent keyboard- and screen-reader-accessible item list is available from the skip control."
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
            <Typography
              variant="h6"
              sx={{
                color: "text.secondary",
              }}
            >
              This canvas is empty
            </Typography>
          </Box>
        ) : (
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            scaleX={zoom}
            scaleY={zoom}
            x={position.x}
            y={position.y}
            draggable={true}
            onDragMove={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onDragEnd={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onWheel={handleWheel}
          >
            <ReadonlyCanvasItemLayer items={items} />
          </Stage>
        )}
      </Box>
    </Box>
  );
}
