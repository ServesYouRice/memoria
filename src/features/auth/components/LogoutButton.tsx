"use client";

import { Button, type ButtonProps } from "@mui/material";
import { signOutAndRedirect } from "@/lib/auth-client";

export function LogoutButton(props: ButtonProps) {
  const handleLogout = async () => {
    await signOutAndRedirect("/auth/login");
  };

  return (
    <Button variant="outlined" onClick={handleLogout} {...props}>
      Sign Out
    </Button>
  );
}
