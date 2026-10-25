import { useEffect, useState } from "react";
import type { Capabilities } from "../shared/contracts";
import { api } from "$lib/api";
import { useSession } from "$lib/auth";
import { Toaster } from "$lib/components/ui/sonner";
import { CONSENT_PATH, RESET_PARAM, WELCOME_PARAM, WELCOME_VALUE } from "$lib/return-to";
import { ThemeProvider } from "$lib/theme";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./screens/AuthScreen";
import { OAuthConsentScreen } from "./screens/OAuthConsentScreen";
import { SetPasswordScreen } from "./screens/SetPasswordScreen";

// S45 — the theme wraps the whole app, so the auth screen follows it too.
// r[impl platform.client.behaviour-suite+2]
export default function App() {
  return (
    <ThemeProvider>
      <SessionGate />
    </ThemeProvider>
  );
}

// S48 — an emailed link landing here: a new account's welcome, or a password
// reset (which shows whether or not a session exists).
type Landing = "welcome" | "reset" | null;

function readLanding(): Landing {
  const params = new URLSearchParams(window.location.search);
  if (params.has(RESET_PARAM)) return "reset";
  return params.get(WELCOME_PARAM) === WELCOME_VALUE ? "welcome" : null;
}

const loading = (
  <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
);

// The session gate: loading, the auth screen, or the signed-in app.
function SessionGate() {
  const session = useSession();
  const [landing, setLanding] = useState(readLanding);
  // A landing honours its param only where the deployment offers the flow; a
  // failed config call reads as offering neither.
  const [capabilities, setCapabilities] = useState<Capabilities | null | undefined>(landing ? undefined : null);

  useEffect(() => {
    if (!landing) return;
    api
      .config()
      .then((c) => setCapabilities(c.capabilities))
      .catch(() => setCapabilities(null));
  }, [landing]);

  // A reset landing ends (a reset done, or Back to sign in) only once the
  // session is refetched — a reset revokes every session — so neither a stale
  // app nor a loading flash replaces the notice on the auth screen.
  async function endLanding() {
    if (landing !== "reset") return;
    await session.refetch();
    setLanding(null);
  }

  if (capabilities === undefined) return loading;
  if (landing === "reset" && capabilities?.passwordReset) return <AuthScreen onLandingDone={endLanding} />;
  if (session.isPending) return loading;
  if (!session.data) return <AuthScreen onLandingDone={endLanding} />;
  // S63 — the MCP connector's consent screen, outside the app shell. Signed
  // out, the auth screen above renders here instead and its sign-in resumes the
  // authorize request.
  if (window.location.pathname === CONSENT_PATH) return <OAuthConsentScreen email={session.data.user.email} />;
  // r[impl identity.auth-screen.welcome-landing]
  if (landing === "welcome" && capabilities?.verifiedSignUp) return <SetPasswordScreen />;
  return (
    <>
      <AppShell user={session.data.user} />
      <Toaster position="bottom-center" />
    </>
  );
}
