import { LoginForm } from '@/features/auth/components/LoginForm';

export const metadata = {
  title: 'Sign in',
  description: 'Sign in to your Memoria account',
};

export default function LoginPage() {
  return <LoginForm />;
}
