"use client";

import React, { useState, useEffect, Suspense } from "react";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  Link,
  TextField,
  Typography,
  Alert,
  CircularProgress,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AuthLayout } from "@/features/auth/components/AuthLayout";

const formSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type FormData = z.infer<typeof formSchema>;

const HEADLINE = "Choose a new password and carry on.";

const linkSx = {
  color: "primary.main",
  textDecoration: "none",
  fontWeight: 500,
  "&:hover": { textDecoration: "underline" },
};

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

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    // No default values: an uncontrolled field keeps whatever the person typed
    // before hydration finished (WebKit can fill a field that early).
  });

  useEffect(() => {
    if (!token) {
      setError("Invalid reset link. Please request a new password reset.");
    }
  }, [token]);

  const onSubmit = async (data: FormData) => {
    if (!token) {
      setError("Invalid reset link");
      return;
    }

    try {
      setError(null);

      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: data.password,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await problemMessage(response, "Failed to reset password"),
        );
      }

      setSuccess(true);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push("/auth/login");
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  if (!token) {
    return (
      <AuthLayout headline={HEADLINE}>
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          sx={{
            fontWeight: 600,
          }}
        >
          Invalid reset link
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          This password reset link is invalid or has expired. Please request a
          new one.
        </Alert>
        <Button
          component={NextLink}
          href="/auth/forgot-password"
          variant="contained"
          fullWidth
        >
          Request new reset link
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout headline={HEADLINE}>
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{
          fontWeight: 600,
        }}
      >
        Choose a new password
      </Typography>

      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 3,
        }}
      >
        Enter your new password below.
      </Typography>

      {success ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Password reset successful! Redirecting to sign in…
        </Alert>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              {...register("password")}
              label="New password"
              type={showPassword ? "text" : "password"}
              fullWidth
              autoFocus
              error={!!errors.password}
              helperText={errors.password?.message}
              disabled={isSubmitting}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        disabled={isSubmitting}
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
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
              startIcon={isSubmitting ? <CircularProgress size={20} /> : null}
            >
              {isSubmitting ? "Saving…" : "Save new password"}
            </Button>

            <Box sx={{ textAlign: "center", mt: 2 }}>
              <Link href="/auth/login" variant="body2" sx={linkSx}>
                Back to sign in
              </Link>
            </Box>
          </Box>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthLayout headline={HEADLINE}>
          <CircularProgress />
        </AuthLayout>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
