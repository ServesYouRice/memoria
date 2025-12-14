'use client';

import { Button, ButtonProps } from '@mui/material';
import { signOut } from 'next-auth/react';

export function LogoutButton(props: ButtonProps) {
  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/login' });
  };

  return (
    <Button variant="outlined" onClick={handleLogout} {...props}>
      Sign Out
    </Button>
  );
}
