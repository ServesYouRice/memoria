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

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const registered = searchParams.get("registered");

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
        } else {
          setError("Invalid email or password");
        }
        return;
      }

      if (result?.ok) {
        router.push("/dashboard");
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
      <Typography variant="h4" component="h1" fontWeight={700} gutterBottom>
        Sign in
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Welcome back! Please enter your details.
      </Typography>

      {registered && (
        <Alert
          severity="success"
          sx={{ mb: 3, animation: "fadeIn 0.4s ease-out" }}
        >
          Account created successfully! Please sign in.
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
          color="text.secondary"
          sx={{ mt: 4 }}
        >
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
            Create one
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
}
