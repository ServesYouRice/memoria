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
import { useRouter } from "next/navigation";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";
import { AuthLayout } from "./AuthLayout";

const registerSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email address"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.type && result.title) {
          if (result.errors && Array.isArray(result.errors)) {
            const errorMessages = result.errors
              .map((err: { message: string }) => err.message)
              .join(". ");
            setError(errorMessages);
          } else {
            setError(result.detail || result.title);
          }
        } else {
          setError("Registration failed. Please try again.");
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/auth/login?registered=true");
      }, 1500);
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
      <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
        Create account
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Sign up to start using Memoria
      </Typography>

      {success && (
        <Alert
          severity="success"
          sx={{ mb: 3, animation: "fadeIn 0.4s ease-out" }}
        >
          Account created! Redirecting you to sign in…
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

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
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
          disabled={isLoading || success}
          sx={{ mt: 3 }}
        >
          {isLoading ? "Creating account…" : "Create account"}
        </Button>

        <Typography
          variant="body2"
          align="center"
          color="text.secondary"
          sx={{ mt: 4 }}
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
    </AuthLayout>
  );
}
