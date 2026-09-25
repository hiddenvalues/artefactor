import { useSession } from "$lib/auth";
import { Toaster } from "$lib/components/ui/sonner";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./screens/AuthScreen";

// The session gate: loading, the auth screen, or the signed-in app.
export default function App() {
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
