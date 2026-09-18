import { AuthFrame } from "@/components/app/auth-frame";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <AuthFrame>{children}</AuthFrame>;
}
