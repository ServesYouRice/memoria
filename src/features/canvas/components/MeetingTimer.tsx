import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Close, Pause, PlayArrow, Refresh, Timer } from "@mui/icons-material";
import {
  MEETING_TIMER_DISCLOSURE,
  MEETING_TIMER_VIEWER_NOTE,
} from "@/lib/product-surfaces";
import {
  SHARED_TIMER_DEFAULT_MS,
  SHARED_TIMER_MAX_MS,
  formatSharedTimer,
  sharedTimerRemainingMs,
  type SharedTimerAction,
} from "@/lib/collaboration/shared-timer";
import type { SharedTimerSnapshot } from "@/lib/hooks/use-collaboration";

/**
 * IMP-105: the meeting timer is shared. The server holds the end time; every
 * screen on the canvas counts down to it, so they agree and a late joiner is
 * right at once. Editors start, pause and reset it; others only watch.
 */
export interface MeetingTimerProps {
  /** The timer as the server last sent it; null before it has. */
  timer?: SharedTimerSnapshot | null;
  onCommand?: (action: SharedTimerAction, durationMs: number) => void;
  /** Whether this person may control the timer (the server checks too). */
  canControl?: boolean;
  /** Whether the live connection is up; the timer needs it. */
  connected?: boolean;
  /**
   * Opens the timer from another control (the "More" menu) instead of the
   * timer's own button.
   */
  externalAnchor?: HTMLElement | null;
  onExternalClose?: () => void;
  /** Hide the countdown button that shows while the timer runs. */
  hideTrigger?: boolean;
}

const MAX_MINUTES = SHARED_TIMER_MAX_MS / 60_000;

export const MeetingTimer: React.FC<MeetingTimerProps> = ({
  timer = null,
  onCommand,
  canControl = false,
  connected = false,
  externalAnchor = null,
  onExternalClose,
  hideTrigger = false,
}) => {
  const [ownAnchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const anchorEl = ownAnchorEl ?? externalAnchor;
  const closeTimer = () => {
    setAnchorEl(null);
    onExternalClose?.();
  };

  const state = timer?.state ?? null;
  const offset = timer?.clockOffsetMs ?? 0;
  const [now, setNow] = useState(() => Date.now());
  const running = state?.status === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [running]);

  const sharedMinutes = Math.round(
    (state?.durationMs ?? SHARED_TIMER_DEFAULT_MS) / 60_000,
  );
  const [minutes, setMinutes] = useState(sharedMinutes);
  // Follow the duration someone else set.
  useEffect(() => setMinutes(sharedMinutes), [sharedMinutes]);

  // Before a start, the minutes field is what a start will run.
  const remainingMs =
    state && state.status !== "idle"
      ? sharedTimerRemainingMs(state, now + offset)
      : minutes * 60_000;
  const timeText = formatSharedTimer(remainingMs);
  const active = state?.status === "running" || state?.status === "paused";
  const ended = running && remainingMs === 0;
  const controls = canControl && connected && Boolean(onCommand);
  const durationMs = minutes * 60_000;

  const open = Boolean(anchorEl);

  return (
    <>
      {!hideTrigger && active && (
        <Button
          size="small"
          color={ended ? "error" : running ? "secondary" : "inherit"}
          startIcon={<Timer />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label={`Shared timer: ${ended ? "time is up" : `${timeText} left`}${running ? "" : ", paused"}`}
          sx={{ fontFamily: "monospace", fontWeight: "bold" }}
        >
          {timeText}
        </Button>
      )}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeTimer}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ p: 2, width: 260 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="h6">Shared timer</Typography>
            <IconButton
              size="small"
              onClick={closeTimer}
              aria-label="Close timer"
            >
              <Close fontSize="small" />
            </IconButton>
          </Box>

          <Typography
            variant="caption"
            sx={{ color: "text.secondary", display: "block", mb: 2 }}
          >
            {MEETING_TIMER_DISCLOSURE}
            {!canControl && ` ${MEETING_TIMER_VIEWER_NOTE}`}
            {!connected && " It needs a live connection; reconnecting…"}
          </Typography>

          <Typography
            variant="h3"
            align="center"
            data-testid="shared-timer-time"
            sx={{
              fontFamily: "monospace",
              mb: 1,
              color: running && remainingMs < 60_000 ? "error.main" : "inherit",
            }}
          >
            {timeText}
          </Typography>
          <Typography
            variant="body2"
            align="center"
            sx={{ color: "text.secondary", mb: 2 }}
          >
            {ended
              ? "Time is up"
              : running
                ? "Running"
                : state?.status === "paused"
                  ? "Paused"
                  : "Not started"}
          </Typography>

          {controls && (
            <>
              <Stack
                direction="row"
                spacing={1}
                sx={{ justifyContent: "center", mb: 2 }}
              >
                {running && !ended ? (
                  <Button
                    variant="contained"
                    color="warning"
                    startIcon={<Pause />}
                    onClick={() => onCommand?.("pause", durationMs)}
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<PlayArrow />}
                    onClick={() =>
                      onCommand?.(ended ? "reset" : "start", durationMs)
                    }
                  >
                    {ended ? "Clear" : "Start"}
                  </Button>
                )}
                <IconButton
                  onClick={() => onCommand?.("reset", durationMs)}
                  aria-label="Reset timer"
                  title="Reset"
                >
                  <Refresh />
                </IconButton>
              </Stack>

              <TextField
                label="Minutes"
                type="number"
                size="small"
                value={minutes}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (!isNaN(value) && value > 0 && value <= MAX_MINUTES) {
                    setMinutes(value);
                  }
                }}
                disabled={active}
                slotProps={{ htmlInput: { min: 1, max: MAX_MINUTES } }}
                fullWidth
              />
            </>
          )}
        </Box>
      </Popover>
    </>
  );
};
