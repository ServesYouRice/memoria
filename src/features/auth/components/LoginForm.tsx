"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  Link,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthLayout } from "./AuthLayout";
import { VerificationResendForm } from "./VerificationResendForm";
import { safeAuthCallbackUrl } from "@/lib/auth/redirect";
import type { RegistrationMode } from "./RegisterForm";

interface LoginFormProps {
  mode?: RegistrationMode;
}

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm({ mode = "open" }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [attemptedEmail, setAttemptedEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const registered = searchParams.get("registered");
  const verified = searchParams.get("verified");
  const callbackUrl = searchParams.get("callbackUrl");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      setError(null);
      setUnverified(false);
      setAttemptedEmail(data.email);

      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        if (result.code === "account_locked") {
          setError(
            "Your account is temporarily locked due to too many failed sign-in attempts. Please wait a few minutes and try again.",
          );
        } else if (result.code === "email_not_verified") {
          setUnverified(true);
          setError(
            "Your password is correct, but your email is not verified yet. Check your inbox before signing in.",
          );
        } else {
          setError("Invalid email or password");
        }
        return;
      }

      if (result?.ok) {
        const safeDestination = safeAuthCallbackUrl(
          callbackUrl,
          window.location.origin,
        );
        const destination =
          new URL(safeDestination).pathname +
          new URL(safeDestination).search +
          new URL(safeDestination).hash;
        router.push(callbackUrl ? destination : "/dashboard");
        router.refresh();
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      headline="Welcome back"
      tagline="Continue your creative journey. Your canvases are waiting for you."
    >
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{
          fontWeight: 700,
        }}
      >
        Sign in
      </Typography>
      <Typography
        variant="body1"
        sx={{
          color: "text.secondary",
          mb: 4,
        }}
      >
        Welcome back! Please enter your details.
      </Typography>

      {registered && (
        <Alert
          severity="success"
          sx={{ mb: 3, animation: "fadeIn 0.4s ease-out" }}
        >
          Account created successfully. Verify your email before signing in.
        </Alert>
      )}

      {verified && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Email verified successfully. You can sign in now.
        </Alert>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3, animation: "fadeIn 0.4s ease-out" }}
        >
          {error}
        </Alert>
      )}

      {unverified && (
        <Box sx={{ mb: 3 }}>
          <VerificationResendForm initialEmail={attemptedEmail} compact />
        </Box>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          {...register("email")}
          label="Email"
          type="email"
          fullWidth
          margin="normal"
          error={!!errors.email}
          helperText={errors.email?.message}
          disabled={isLoading}
          autoComplete="email"
          autoFocus
          sx={{ mb: 2 }}
        />

        <TextField
          {...register("password")}
          label="Password"
          type={showPassword ? "text" : "password"}
          fullWidth
          margin="normal"
          error={!!errors.password}
          helperText={errors.password?.message}
          disabled={isLoading}
          autoComplete="current-password"
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    disabled={isLoading}
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

        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1, mb: 2 }}>
          <Link
            href="/auth/forgot-password"
            variant="body2"
            sx={{
              color: "primary.main",
              textDecoration: "none",
              fontWeight: 500,
              "&:hover": { textDecoration: "underline" },
            }}
          >
            Forgot password?
          </Link>
        </Box>

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={isLoading}
        >
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>

        <Typography
          variant="body2"
          align="center"
          sx={{
            color: "text.secondary",
            mt: 4,
          }}
        >
          {mode === "closed" ? (
            "Registration is currently closed."
          ) : (
            <>
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/register"
                sx={{
                  color: "primary.main",
                  textDecoration: "none",
                  fontWeight: 600,
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                {mode === "invite" ? "Use an invitation" : "Create one"}
              </Link>
            </>
          )}
        </Typography>
      </Box>
    </AuthLayout>
  );
}
