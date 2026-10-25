import { useState, type FormEvent } from "react";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { FieldError } from "./UploadDialog";

// What the server may refuse an invite with (`identity.org-admin.invite-domain`).
export type InviteRefusal = "invalid-email" | "outside-domains" | "already-member" | "already-invited";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const domainList = (domains: readonly string[]) => domains.join(", ");

function refusalMessage(refusal: InviteRefusal, email: string, domains: readonly string[]): string {
  switch (refusal) {
    case "already-member":
      return `${email} is already a member`;
    case "already-invited":
      return `${email} already has a pending invitation`;
    case "invalid-email":
      return `${email} isn’t a valid email address`;
    case "outside-domains":
      return `Only addresses at ${domainList(domains)} can be invited`;
  }
}

// S58 — "Invite people": one Email field, with Send invite enabled only for a
// valid address at one of the org's invite domains. That check is a
// convenience; the server decides, and a refusal keeps the dialog open with its
// reason. Mounted per open.
export function InviteDialog({
  domains,
  onSend,
  onClose,
  initialEmail = "",
  initialRefusal,
}: {
  domains: readonly string[];
  // Resolves with `null` once the invitation is sent (the caller closes the
  // dialog), or with the server's refusal; rejects on any other failure.
  onSend: (email: string) => Promise<InviteRefusal | null>;
  onClose: () => void;
  // Previews only: start with an address typed, or a refusal shown.
  initialEmail?: string;
  initialRefusal?: InviteRefusal;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ refusal: InviteRefusal; email: string } | null>(
    initialRefusal ? { refusal: initialRefusal, email: initialEmail.trim().toLowerCase() } : null,
  );

  const address = email.trim().toLowerCase();
  const valid = EMAIL.test(address);
  const atDomain = valid && domains.some((d) => d.toLowerCase() === address.slice(address.lastIndexOf("@") + 1));
  const canSend = !busy && atDomain;
  // A refusal shown for an address no longer in the field is stale.
  const error = refused && refused.email === address
    ? refusalMessage(refused.refusal, refused.email, domains)
    : valid && !atDomain
      ? refusalMessage("outside-domains", address, domains)
      : null;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      const refusal = await onSend(address);
      if (refusal) setRefused({ refusal, email: address });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void send(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Invite people</DialogTitle>
            <DialogDescription>
              Invitees get an email asking them to sign up and join as Members. Addresses at{" "}
              {domainList(domains)}.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="invite-email" className="mb-2">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`name@${domains[0] ?? "example.com"}`}
              autoComplete="off"
              aria-invalid={!!error}
            />
            {error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSend}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
