import { Button } from "$lib/components/ui/button";

// S33a / S48 — the check-your-inbox state after a link was emailed. It never
// says whether the address has an account.
export type EmailSentKind = "sign-in" | "sign-up" | "reset";

const MESSAGES: Record<EmailSentKind, (email: string) => string> = {
  "sign-in": (email) => `Check your inbox — we sent a sign-in link to ${email}`,
  "sign-up": (email) => `Check your inbox — we sent a link to ${email}. Open it to finish creating your account.`,
  reset: (email) => `If an account exists for ${email}, we sent a reset link`,
};

const BACK: Record<EmailSentKind, string> = {
  "sign-in": "Use a different email",
  "sign-up": "Use a different email",
  reset: "Back to sign in",
};

export function EmailSentPanel({ kind, email, onBack }: { kind: EmailSentKind; email: string; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-2 text-center">
      <p className="text-sm">{MESSAGES[kind](email)}</p>
      <Button variant="link" onClick={onBack}>
        {BACK[kind]}
      </Button>
    </div>
  );
}
