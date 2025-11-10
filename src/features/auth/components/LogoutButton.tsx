'use client';

import { Button } from '@mui/material';
import { signOut } from 'next-auth/react';

export function LogoutButton() {
  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/login' });
  };

  return (
    <Button variant="outlined" onClick={handleLogout}>
      Sign Out
    </Button>
  );
}
