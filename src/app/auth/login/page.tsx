import { LoginForm } from "@/features/auth/components/LoginForm";
import { env } from "@/lib/env";

export const metadata = {
  title: "Sign in",
  description: "Sign in to your Memoria account",
};

export default function LoginPage() {
  return <LoginForm mode={env.REGISTRATION_MODE} />;
}
