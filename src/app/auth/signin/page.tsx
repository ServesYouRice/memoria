import { redirect } from 'next/navigation';

/**
 * Sign-In route redirect
 *
 * This route is kept for legacy links and forwards to the primary login page.
 */
export default function SignInPage() {
  redirect('/auth/login');
}
