import { AppShell } from "@/components/app/app-shell";
import { RequireSession } from "@/components/app/require-session";

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireSession>
      <AppShell>{children}</AppShell>
    </RequireSession>
  );
}
