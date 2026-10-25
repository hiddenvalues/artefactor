import { useId, useState, type FormEvent } from "react";
import { FieldError } from "$lib/components/UploadDialog";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";

// S48 — choosing a password, for the set-password landing and a reset link:
// new + confirm, checked against each other before anything is sent.
export const PASSWORD_MISMATCH = "The passwords don't match";

// BetterAuth's codes for a refused password, in the words the screens use;
// anything else reads as `fallback`.
const PASSWORD_ERRORS: Record<string, string> = {
  PASSWORD_TOO_SHORT: "That password is too short",
  PASSWORD_TOO_LONG: "That password is too long",
  PASSWORD_ALREADY_SET: "This account already has a password",
  SESSION_NOT_FRESH: "For your security, sign in again with a link to set a password",
};

export function passwordErrorMessage(code: string | undefined, fallback: string): string {
  return (code && PASSWORD_ERRORS[code]) || fallback;
}

export function NewPasswordForm({
  submitLabel,
  busy = false,
  error = null,
  onSubmit,
}: {
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (newPassword: string) => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const differs = password !== confirm;
    setMismatch(differs);
    if (!differs) onSubmit(password);
  }

  const shown = mismatch ? PASSWORD_MISMATCH : error;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-new`}>New password</Label>
        <Input
          id={`${id}-new`}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Confirm password</Label>
        <Input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      {shown && <FieldError>{shown}</FieldError>}
      <Button type="submit" disabled={busy} className="mt-0.5">
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
