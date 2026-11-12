"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  TextField,
  Typography,
  Alert,
  Link,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Fingerprint, Visibility, VisibilityOff } from "@mui/icons-material";
import { authClient } from "@/lib/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ACCOUNT_LOCKOUT_DURATION_MS,
  AUTH_RATE_LIMIT_WINDOW_MS,
} from "@/lib/constants";
import { AuthLayout } from "./AuthLayout";
import { VerificationResendForm } from "./VerificationResendForm";
import { toSafeCallbackPath } from "@/lib/auth/redirect";
import type { RegistrationMode } from "./RegisterForm";

interface LoginFormProps {
  mode?: RegistrationMode;
}

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const totpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
const backupCodeSchema = z
  .string()
  .trim()
  .min(6, "Enter one of your backup codes")
  .max(64);

type AuthErrorLike = { code?: string; status?: number } | null | undefined;

/** "about 2 minutes", "45 seconds", "up to 15 minutes". */
export function describeWait(
  retryAfterSeconds: number | null,
  fallbackMs: number,
): string {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    if (retryAfterSeconds < 60) {
      return `${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}`;
    }
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `up to ${Math.round(fallbackMs / 60_000)} minutes`;
}

/** The server's Retry-After value in seconds, when the response has one. */
export function retryAfterSeconds(response?: Response | null): number | null {
  const value = Number.parseInt(response?.headers.get("retry-after") ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function tooManyAttemptsMessage(
  retryAfter: number | null,
  what = "sign-in attempts",
): string {
  return `Too many ${what}. Please try again in ${describeWait(
    retryAfter,
    AUTH_RATE_LIMIT_WINDOW_MS,
  )}.`;
}

const LOCKED_MESSAGE = `Your account is temporarily locked after too many failed sign-in attempts. Please try again in ${describeWait(
  null,
  ACCOUNT_LOCKOUT_DURATION_MS,
)}.`;

export function secondFactorErrorMessage(
  error: AuthErrorLike,
  retryAfter: number | null = null,
): string {
  // The proxy rate-limits /api/auth/two-factor/ with a 429 that has no code.
  if (error?.status === 429) {
    return tooManyAttemptsMessage(retryAfter, "attempts");
  }
  switch (error?.code) {
    case "ACCOUNT_LOCKED":
      return LOCKED_MESSAGE;
    case "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE":
    case "INVALID_TWO_FACTOR_COOKIE":
      return "This sign-in attempt expired. Enter your email and password again.";
    case "INVALID_BACKUP_CODE":
      return "That backup code is not valid.";
    default:
      return "That code is not valid. Check your authenticator app and try again.";
  }
}

export function LoginForm({ mode = "open" }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [attemptedEmail, setAttemptedEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [secondFactor, setSecondFactor] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [secondFactorCode, setSecondFactorCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);

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

  const goToDestination = () => {
    router.push(
      toSafeCallbackPath(callbackUrl, window.location.origin, "/dashboard"),
    );
    router.refresh();
  };

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      setError(null);
      setUnverified(false);
      setAttemptedEmail(data.email);

      let retryAfter: number | null = null;
      const { data: result, error: signInError } =
        await authClient.signIn.email(
          { email: data.email, password: data.password },
          {
            onError: (context: { response?: Response }) => {
              retryAfter = retryAfterSeconds(context.response);
            },
          },
        );

      if (signInError) {
        if (signInError.code === "ACCOUNT_LOCKED") {
          setError(LOCKED_MESSAGE);
        } else if (signInError.code === "EMAIL_NOT_VERIFIED") {
          setUnverified(true);
          setError(
            "Your password is correct, but your email is not verified yet. Check your inbox before signing in.",
          );
        } else if (signInError.status === 429) {
          setError(tooManyAttemptsMessage(retryAfter));
        } else if (
          signInError.code === "LOGIN_SAFETY_UNAVAILABLE" ||
          signInError.status === 503
        ) {
          // The lockout store is down; the server refuses every sign-in.
          setError(
            "Sign-in is temporarily unavailable. Please try again in a few minutes.",
          );
        } else {
          setError("Invalid email or password");
        }
        return;
      }

      if (result && "twoFactorRedirect" in result && result.twoFactorRedirect) {
        setSecondFactor(true);
        setSecondFactorCode("");
        return;
      }

      goToDestination();
    } catch (err) {
      console.error("Login error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmitSecondFactor = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = (
      useBackupCode ? backupCodeSchema : totpCodeSchema
    ).safeParse(secondFactorCode.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid code");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      let retryAfter: number | null = null;
      const fetchOptions = {
        onError: (context: { response?: Response }) => {
          retryAfter = retryAfterSeconds(context.response);
        },
      };
      const { error: verifyError } = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode(
            { code: parsed.data, trustDevice },
            fetchOptions,
          )
        : await authClient.twoFactor.verifyTotp(
            { code: parsed.data, trustDevice },
            fetchOptions,
          );
      if (verifyError) {
        setError(secondFactorErrorMessage(verifyError, retryAfter));
        if (
          verifyError.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" ||
          verifyError.code === "INVALID_TWO_FACTOR_COOKIE"
        ) {
          setSecondFactor(false);
        }
        return;
      }
      goToDestination();
    } catch (err) {
      console.error("Two-factor error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onPasskeySignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setUnverified(false);
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        const code = (result.error as AuthErrorLike)?.code;
        if (code !== "AUTH_CANCELLED") {
          setError("Passkey sign-in failed. Try again or use your password.");
        }
        return;
      }
      goToDestination();
    } catch (err) {
      console.error("Passkey error:", err);
      setError("Passkey sign-in failed. Try again or use your password.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout headline="Welcome back. Your canvases are waiting.">
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

      {secondFactor ? (
        <Box component="form" onSubmit={onSubmitSecondFactor} noValidate>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {useBackupCode
              ? "Enter one of the backup codes you saved when you set up two-factor authentication."
              : "Enter the 6-digit code from your authenticator app."}
          </Typography>
          <TextField
            label={useBackupCode ? "Backup code" : "Authentication code"}
            value={secondFactorCode}
            onChange={(event) => setSecondFactorCode(event.target.value)}
            fullWidth
            margin="normal"
            disabled={isLoading}
            autoComplete="one-time-code"
            autoFocus
            slotProps={{
              htmlInput: useBackupCode
                ? { maxLength: 64 }
                : { inputMode: "numeric", pattern: "[0-9]*", maxLength: 6 },
            }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                disabled={isLoading}
              />
            }
            label="Trust this device for 30 days"
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={isLoading}
            sx={{ mt: 2 }}
          >
            {isLoading ? "Verifying…" : "Verify"}
          </Button>
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2 }}>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => {
                setUseBackupCode(!useBackupCode);
                setSecondFactorCode("");
                setError(null);
              }}
            >
              {useBackupCode
                ? "Use your authenticator app"
                : "Use a backup code instead"}
            </Link>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => {
                setSecondFactor(false);
                setUseBackupCode(false);
                setSecondFactorCode("");
                setError(null);
              }}
            >
              Start over
            </Link>
          </Box>
        </Box>
      ) : (
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Button
            type="button"
            variant="outlined"
            fullWidth
            size="large"
            disabled={isLoading}
            startIcon={<Fingerprint />}
            onClick={onPasskeySignIn}
            sx={{ mt: 1 }}
          >
            Use a passkey
          </Button>

          <Divider sx={{ mt: 3, mb: 1 }}>or use your email</Divider>

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

          <Box
            sx={{ display: "flex", justifyContent: "flex-end", mt: 1, mb: 2 }}
          >
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
      )}
    </AuthLayout>
  );
}
