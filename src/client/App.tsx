import { useSession } from "$lib/auth";
import { Toaster } from "$lib/components/ui/sonner";
import { ThemeProvider } from "$lib/theme";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./screens/AuthScreen";

// S45 — the theme wraps the whole app, so the auth screen follows it too.
export default function App() {
  return (
    <ThemeProvider>
      <SessionGate />
    </ThemeProvider>
  );
}

// The session gate: loading, the auth screen, or the signed-in app.
function SessionGate() {
  const session = useSession();
  if (session.isPending)
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!session.data) return <AuthScreen />;
  return (
    <>
      <AppShell user={session.data.user} />
      <Toaster position="bottom-center" />
    </>
  );
}
