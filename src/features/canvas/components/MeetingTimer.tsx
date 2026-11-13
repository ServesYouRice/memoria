import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  IconButton,
  Popover,
  Typography,
  Button,
  TextField,
  Stack,
} from "@mui/material";
import { Timer, PlayArrow, Pause, Refresh, Close } from "@mui/icons-material";
import { MEETING_TIMER_DISCLOSURE } from "@/lib/product-surfaces";

/**
 * DEC-012: the meeting timer is personal UI. State lives in this component
 * only — it is not persisted, not synchronized, and every collaborator runs
 * their own. The copy below says so rather than implying a shared countdown.
 */
export interface MeetingTimerProps {
  /**
   * Opens the timer from another control (the phone "More" menu) instead of
   * the timer's own button; the timer keeps running while it is closed.
   */
  externalAnchor?: HTMLElement | null;
  onExternalClose?: () => void;
  /** Hide the timer's own button (its state stays mounted). */
  hideTrigger?: boolean;
}

export const MeetingTimer: React.FC<MeetingTimerProps> = ({
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
  const [timeLeft, setTimeLeft] = useState(0);
  const [duration, setDuration] = useState(15); // minutes
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, timeLeft]);

  const handleStart = () => {
    if (timeLeft === 0) {
      setTimeLeft(duration * 60);
    }
    setIsRunning(true);
  };

  const handlePause = () => {
    setIsRunning(false);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(duration * 60);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const open = Boolean(anchorEl);

  return (
    <>
      {!hideTrigger && (
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          color={isRunning ? "secondary" : "default"}
          aria-label="Personal meeting timer (not shared with collaborators)"
        >
          <Timer />
          {isRunning && (
            <Typography variant="caption" sx={{ ml: 0.5, fontWeight: "bold" }}>
              {formatTime(timeLeft)}
            </Typography>
          )}
        </IconButton>
      )}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeTimer}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        <Box sx={{ p: 2, width: 250 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Typography variant="h6">Personal timer</Typography>
            <IconButton size="small" onClick={closeTimer}>
              <Close fontSize="small" />
            </IconButton>
          </Box>

          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block",
              mb: 2,
            }}
          >
            {MEETING_TIMER_DISCLOSURE}
          </Typography>

          <Typography
            variant="h3"
            align="center"
            sx={{
              fontFamily: "monospace",
              mb: 2,
              color: timeLeft < 60 && timeLeft > 0 ? "error.main" : "inherit",
            }}
          >
            {formatTime(timeLeft || duration * 60)}
          </Typography>

          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "center",
              mb: 2,
            }}
          >
            {!isRunning ? (
              <Button
                variant="contained"
                color="primary"
                startIcon={<PlayArrow />}
                onClick={handleStart}
              >
                Start
              </Button>
            ) : (
              <Button
                variant="contained"
                color="warning"
                startIcon={<Pause />}
                onClick={handlePause}
              >
                Pause
              </Button>
            )}
            <IconButton onClick={handleReset} title="Reset">
              <Refresh />
            </IconButton>
          </Stack>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <TextField
              label="Duration (min)"
              type="number"
              size="small"
              value={duration}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val) && val > 0) {
                  setDuration(val);
                  if (!isRunning) setTimeLeft(val * 60);
                }
              }}
              disabled={isRunning}
            />
          </Box>
        </Box>
      </Popover>
    </>
  );
};
