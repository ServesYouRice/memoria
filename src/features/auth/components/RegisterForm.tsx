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
import {
  Visibility,
  VisibilityOff,
  Person as PersonIcon,
  Email as EmailIcon,
  Lock as LockIcon,
} from "@mui/icons-material";
import { useSearchParams } from "next/navigation";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";
import { AuthLayout } from "./AuthLayout";
import { VerificationResendForm } from "./VerificationResendForm";

export type RegistrationMode = "open" | "invite" | "closed";

interface RegisterFormProps {
  mode?: RegistrationMode;
}

const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm({ mode = "open" }: RegisterFormProps) {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("inviteToken") || "";
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [registration, setRegistration] = useState<{
    email: string;
    deliveryAccepted: boolean;
  } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const password = watch("password", "");
  const email = watch("email", "");
  const name = watch("name", "");

  const onSubmit = async (data: RegisterFormData) => {
    if (mode === "closed" || (mode === "invite" && !inviteToken)) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...data,
          inviteToken: inviteToken || undefined,
        }),
      });

      const result = (await response.json().catch(() => null)) as {
        type?: string;
        title?: string;
        detail?: string;
        errors?: Array<{ message?: string }>;
        email?: string;
        verificationEmailQueued?: boolean;
      } | null;

      if (!response.ok) {
        const errorMessages = result?.errors
          ?.map((item) => item.message)
          .filter((message): message is string => Boolean(message))
          .join(". ");
        setError(
          errorMessages ||
            result?.detail ||
            result?.title ||
            "Registration failed. Please try again.",
        );
        return;
      }

      setRegistration({
        email: result?.email || data.email,
        deliveryAccepted: result?.verificationEmailQueued !== false,
      });
    } catch (err) {
      console.error("Registration error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      headline="Start your journey"
      tagline="Create your free account and unlock unlimited creative possibilities."
    >
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{
          fontWeight: 700,
        }}
      >
        Create account
      </Typography>
      <Typography
        variant="body1"
        sx={{
          color: "text.secondary",
          mb: 4,
        }}
      >
        Sign up to start using Memoria
      </Typography>

      {mode === "closed" && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Registration is currently closed. Ask an administrator for access.
        </Alert>
      )}

      {mode === "invite" && !inviteToken && (
        <Alert severity="info" sx={{ mb: 3 }}>
          An invitation link is required to create an account.
        </Alert>
      )}

      {registration && (
        <Box sx={{ mb: 3 }}>
          <Alert
            severity={registration.deliveryAccepted ? "success" : "warning"}
          >
            {registration.deliveryAccepted
              ? "Account created. Check your inbox for the verification link before signing in."
              : "Account created, but delivery could not be confirmed. Request another verification email below."}
          </Alert>
          <Box sx={{ mt: 2 }}>
            <VerificationResendForm initialEmail={registration.email} compact />
          </Box>
        </Box>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3, animation: "fadeIn 0.4s ease-out" }}
        >
          {error}
        </Alert>
      )}

      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        sx={{
          display:
            registration ||
            mode === "closed" ||
            (mode === "invite" && !inviteToken)
              ? "none"
              : undefined,
        }}
      >
        <TextField
          {...register("name")}
          label="Full name"
          fullWidth
          margin="normal"
          error={!!errors.name}
          helperText={errors.name?.message}
          disabled={isLoading}
          autoFocus
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <PersonIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
        />

        <TextField
          {...register("email")}
          label="Email address"
          type="email"
          fullWidth
          margin="normal"
          error={!!errors.email}
          helperText={errors.email?.message}
          disabled={isLoading}
          autoComplete="email"
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <EmailIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
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
          autoComplete="new-password"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <LockIcon color="action" />
                </InputAdornment>
              ),
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

        <PasswordStrengthIndicator
          password={password}
          userInputs={[email, name]}
        />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={isLoading || Boolean(registration)}
          sx={{ mt: 3 }}
        >
          {isLoading ? "Creating account…" : "Create account"}
        </Button>

        <Typography
          variant="body2"
          align="center"
          sx={{
            color: "text.secondary",
            mt: 4,
          }}
        >
          Already have an account?{" "}
          <Link
            href="/auth/login"
            sx={{
              color: "primary.main",
              textDecoration: "none",
              fontWeight: 600,
              "&:hover": { textDecoration: "underline" },
            }}
          >
            Sign in
          </Link>
        </Typography>
      </Box>
      {(registration ||
        mode === "closed" ||
        (mode === "invite" && !inviteToken)) && (
        <Typography
          variant="body2"
          align="center"
          sx={{
            color: "text.secondary",
            mt: 3,
          }}
        >
          Already have an account? <Link href="/auth/login">Sign in</Link>
        </Typography>
      )}
    </AuthLayout>
  );
}
