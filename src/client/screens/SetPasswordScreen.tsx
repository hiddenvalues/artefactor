import { useState } from "react";
import { authClient } from "$lib/auth";
import { Logo } from "$lib/components/Logo";
import { NewPasswordForm, passwordErrorMessage } from "$lib/components/NewPasswordForm";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent } from "$lib/components/ui/card";
import { readReturnTo } from "$lib/return-to";

// S48 — the welcome landing: a new account, just signed in by an emailed link,
// may choose a password. The endpoint is a superset's (EI4); the session gate
// renders this screen only when `/api/config` reports `verifiedSignUp`.
// r[impl identity.auth-screen.set-password]
export function SetPasswordScreen() {
  const [returnTo] = useState(readReturnTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving drops the `welcome` param with the rest of the landing query.
  const leave = () => window.location.replace(returnTo ?? "/");

  async function setPassword(newPassword: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await authClient.$fetch("/set-password", { method: "POST", body: { newPassword } });
      if (!res.error) return leave();
      setError(passwordErrorMessage((res.error as { code?: string }).code, "We couldn't set your password. Try again."));
    } catch {
      setError("We couldn't set your password. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-lg font-semibold">Choose a password</h1>
              <p className="text-sm text-muted-foreground">Sign in with it next time, or keep using email links.</p>
            </div>
            <NewPasswordForm submitLabel="Set password" busy={busy} error={error} onSubmit={setPassword} />
            <Button variant="link" onClick={leave} disabled={busy}>
              Skip — I'll sign in with email links
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
