import { LoginForm } from "@/features/auth/components/LoginForm";
import { env } from "@/lib/env";
import { ssoConfigFromEnv } from "@/lib/auth/sso";

export const metadata = {
  title: "Sign in",
  description: "Sign in to your Memoria account",
};

export default function LoginPage() {
  // Only the button label reaches the browser; the secret stays here.
  const sso = ssoConfigFromEnv(env);
  return (
    <LoginForm mode={env.REGISTRATION_MODE} ssoLabel={sso?.label ?? null} />
  );
}
