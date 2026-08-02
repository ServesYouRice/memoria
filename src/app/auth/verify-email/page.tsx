"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Button,
  Container,
  Typography,
  Alert,
  Paper,
  CircularProgress,
} from "@mui/material";
import { CheckCircle } from "@mui/icons-material";
import { VerificationResendForm } from "@/features/auth/components/VerificationResendForm";

type VerificationState =
  | "loading"
  | "success"
  | "expired"
  | "used"
  | "invalid"
  | "failed-delivery"
  | "error";

function classifyVerificationFailure(
  status: number,
  data: Record<string, unknown>,
): VerificationState {
  const text = [data.code, data.detail, data.message, data.title]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (text.includes("delivery")) return "failed-delivery";
  if (text.includes("expired")) return "expired";
  if (text.includes("already been used") || text.includes("used"))
    return "used";
  if (status === 404 || text.includes("invalid")) return "invalid";
  return "error";
}

function stateCopy(state: Exclude<VerificationState, "loading" | "success">) {
  switch (state) {
    case "expired":
      return "This verification link has expired. Request a new link below.";
    case "used":
      return "This verification link has already been used. Request a new link if you still need one.";
    case "invalid":
      return "This verification link is invalid. Request a new link below.";
    case "failed-delivery":
      return "The verification message could not be delivered. Request a new link below.";
    default:
      return "We could not verify this link. Request a new link below or contact support.";
  }
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<VerificationState>("loading");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch("/api/v1/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok) {
          setState(classifyVerificationFailure(response.status, data));
          return;
        }
        setState("success");
        window.setTimeout(() => router.push("/auth/login?verified=1"), 1200);
      } catch {
        setState("error");
      }
    };

    void verifyEmail();
  }, [token, router]);

  if (state === "loading") {
    return (
      <Container maxWidth="sm">
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Paper
            variant="outlined"
            sx={{ p: 4, borderRadius: 3, width: "100%", textAlign: "center" }}
          >
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="h6">Verifying your email…</Typography>
          </Paper>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Paper
          variant="outlined"
          sx={{ p: 4, borderRadius: 3, width: "100%", textAlign: "center" }}
        >
          {state === "success" ? (
            <>
              <CheckCircle
                sx={{ fontSize: 80, color: "success.main", mb: 2 }}
              />
              <Typography variant="h4" gutterBottom fontWeight={600}>
                Email verified
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                Your email is verified. Taking you to sign in…
              </Typography>
              <Button
                component={Link}
                href="/auth/login?verified=1"
                variant="contained"
                size="large"
              >
                Continue to sign in
              </Button>
            </>
          ) : (
            <>
              <Typography
                variant="h4"
                gutterBottom
                fontWeight={600}
                color="error"
              >
                Verification unavailable
              </Typography>
              <Alert severity="error" sx={{ mb: 3, textAlign: "left" }}>
                {stateCopy(state)}
              </Alert>
              <VerificationResendForm />
              <Button
                component={Link}
                href="/auth/login"
                variant="text"
                sx={{ mt: 2 }}
              >
                Back to sign in
              </Button>
            </>
          )}
        </Paper>
      </Box>
    </Container>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<CircularProgress />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
