"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import NextLink from "next/link";
import { Box, Typography, Button, Paper, Stack } from "@mui/material";
import {
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  Home as HomeIcon,
} from "@mui/icons-material";

interface Props {
  children: ReactNode;
  /** Invoked before a scoped retry so callers can drop derived state. */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Remounts the subtree so a scoped retry re-runs the failed render. */
  resetKey: number;
}

export class CanvasErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    resetKey: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Canvas Error Boundary caught an error:", error, errorInfo);
  }

  /** Canvas-scoped recovery: retry this view without discarding the session. */
  private handleRetry = () => {
    this.props.onReset?.();
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            bgcolor: "background.default",
            p: 3,
          }}
          role="alert"
        >
          <Paper
            elevation={3}
            sx={{
              p: 4,
              maxWidth: 500,
              textAlign: "center",
              borderRadius: 2,
            }}
          >
            <WarningIcon color="error" sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h5" gutterBottom fontWeight={600}>
              Something went wrong with the canvas
            </Typography>
            <Typography color="text.secondary" paragraph>
              {this.state.error?.message ||
                "An unexpected error occurred while rendering the canvas."}
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Edits that had not finished saving may not have been stored.
              Reopening the canvas shows the last state the server accepted.
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              justifyContent="center"
              sx={{ mt: 2 }}
            >
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={this.handleRetry}
              >
                Try again
              </Button>
              <Button variant="outlined" onClick={this.handleReload}>
                Reload canvas
              </Button>
              <Button
                component={NextLink}
                href="/dashboard"
                startIcon={<HomeIcon />}
              >
                Back to dashboard
              </Button>
            </Stack>
          </Paper>
        </Box>
      );
    }

    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
