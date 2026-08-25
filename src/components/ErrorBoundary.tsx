"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Typography, Paper } from "@mui/material";
import {
  Refresh as RefreshIcon,
  ErrorOutlined as ErrorIcon,
} from "@mui/icons-material";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const SAFE_ERROR_MESSAGES = new Set([
  "The requested canvas could not be found.",
  "You do not have permission to view this canvas.",
  "Failed to load canvas data.",
  "Failed to load note content.",
  "Network connection lost.",
]);

function getSafeErrorMessage(error: Error | null): string {
  if (!error)
    return "An unexpected error occurred while rendering this component.";
  if (SAFE_ERROR_MESSAGES.has(error.message)) {
    return error.message;
  }
  return "An unexpected error occurred while rendering this component.";
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      const digest = (this.state.error as any)?.digest;

      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            minHeight: 400,
            p: 3,
            bgcolor: "background.default",
          }}
        >
          <Paper
            elevation={3}
            sx={{
              p: 4,
              maxWidth: 500,
              textAlign: "center",
              borderRadius: 4,
              border: "1px solid",
              borderColor: "error.light",
              bgcolor: "background.paper",
            }}
          >
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                bgcolor: "error.soft",
                color: "error.main",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mx: "auto",
                mb: 2,
              }}
            >
              <ErrorIcon sx={{ fontSize: 40 }} />
            </Box>
            <Typography
              variant="h5"
              gutterBottom
              sx={{
                fontWeight: "bold",
                color: "text.primary",
              }}
            >
              Something went wrong
            </Typography>
            <Typography
              variant="body1"
              sx={{
                mb: 2,
                color: "text.secondary",
              }}
            >
              {getSafeErrorMessage(this.state.error)}
            </Typography>
            {digest && (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mb: 2,
                  color: "text.secondary",
                  fontFamily: "monospace",
                }}
              >
                Incident ID: {digest}
              </Typography>
            )}
            <Button
              variant="contained"
              color="primary"
              startIcon={<RefreshIcon />}
              onClick={this.reset}
              sx={{ mt: 2 }}
            >
              Try Again
            </Button>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}
