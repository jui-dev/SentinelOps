import { RequireSession } from "@/components/app/require-session";
import { WorkspaceShell } from "@/components/app/workspace-shell";

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireSession>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RequireSession>
  );
}
