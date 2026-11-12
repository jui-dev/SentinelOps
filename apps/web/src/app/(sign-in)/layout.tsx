import { AuthFrame } from "@/components/app/auth-frame";

/**
 * The login page, apart from the other sign-in pages: it draws its own
 * card — signing in, and the demo accounts beside it — so it takes the wide
 * frame without the card the others share.
 */
export default function SignInLayout({ children }: LayoutProps<"/">) {
  return <AuthFrame width="wide">{children}</AuthFrame>;
}
