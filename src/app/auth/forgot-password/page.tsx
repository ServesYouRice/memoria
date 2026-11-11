"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Alert,
  Paper,
  CircularProgress,
} from "@mui/material";
import { ArrowBack } from "@mui/icons-material";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
});

type FormData = z.infer<typeof formSchema>;

/** The server's problem+json reason (detail, then title), else `fallback`. */
async function problemMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const problem = (await response.json()) as {
      detail?: unknown;
      title?: unknown;
    };
    if (typeof problem.detail === "string" && problem.detail)
      return problem.detail;
    if (typeof problem.title === "string" && problem.title)
      return problem.title;
  } catch {
    // Not a JSON body (a proxy error page, for example).
  }
  return fallback;
}

export default function ForgotPasswordPage() {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    // No default values: an uncontrolled field keeps whatever the person typed
    // before hydration finished (WebKit can fill a field that early).
  });

  const onSubmit = async (data: FormData) => {
    try {
      setError(null);

      const response = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(
          await problemMessage(response, "Failed to send reset email"),
        );
      }

      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send reset email",
      );
    }
  };

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
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, width: "100%" }}>
          <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              component={Link}
              href="/auth/login"
              startIcon={<ArrowBack />}
              sx={{ mr: "auto" }}
            >
              Back to Login
            </Button>
          </Box>

          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            sx={{
              fontWeight: 600,
            }}
          >
            Forgot Password?
          </Typography>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 3,
            }}
          >
            Enter your email address and we&apos;ll send you instructions to
            reset your password.
          </Typography>

          {success ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              If an account exists with this email, you will receive password
              reset instructions. Please check your email inbox (and spam
              folder).
            </Alert>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <TextField
                  {...register("email")}
                  label="Email Address"
                  type="email"
                  fullWidth
                  autoFocus
                  error={!!errors.email}
                  helperText={errors.email?.message}
                  disabled={isSubmitting}
                />

                {error && (
                  <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                  </Alert>
                )}

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={isSubmitting}
                  startIcon={
                    isSubmitting ? <CircularProgress size={20} /> : null
                  }
                >
                  {isSubmitting ? "Sending..." : "Send Reset Instructions"}
                </Button>

                <Box sx={{ textAlign: "center", mt: 2 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    Don&apos;t have an account?{" "}
                    <Link
                      href="/auth/register"
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      Sign Up
                    </Link>
                  </Typography>
                </Box>
              </Box>
            </form>
          )}
        </Paper>
      </Box>
    </Container>
  );
}
