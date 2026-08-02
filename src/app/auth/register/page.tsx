import { RegisterForm } from "@/features/auth/components/RegisterForm";
import { env } from "@/lib/env";

export const metadata = {
  title: "Register",
  description: "Create your Memoria account",
};

export default function RegisterPage() {
  return <RegisterForm mode={env.REGISTRATION_MODE} />;
}
