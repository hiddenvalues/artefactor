import { useState, type FormEvent } from "react";
import { Check, CircleAlert } from "lucide-react";
import type { MeResponse } from "../../shared/contracts";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { api } from "$lib/api";
import { initials } from "$lib/format";
import { notify } from "$lib/toast";

// S57 — Account screen: who you are, and your name, which you can change. The
// email is BetterAuth's and shown read-only (docs/design/templates/account-settings.md).
export function AccountScreen({
  user,
  onSaved,
}: {
  user: { name: string; email: string };
  // The fresh identity `PATCH /api/me` answered with, for the shell to take.
  onSaved: (me: MeResponse) => void;
}) {
  const [draft, setDraft] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const displayName = user.name || user.email;
  const next = draft.trim();
  const canSave = !saving && next !== "" && next !== user.name;

  // r[impl platform.account.save-name+2]
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const me = await api.updateMe(next);
      // Settle the field on the saved name, unless it was edited meanwhile.
      setDraft((d) => (d.trim() === next ? me.name : d));
      onSaved(me);
      notify("Name saved", Check);
    } catch {
      notify("Couldn’t save your name", CircleAlert);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-160">
      <h1 className="text-xl font-semibold tracking-tight">Account</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Your profile.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback className="font-semibold">{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{displayName}</div>
              <div className="truncate text-sm text-muted-foreground">{user.email}</div>
            </div>
          </div>

          <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2">
            <Label htmlFor="account-name">Name</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="account-name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoComplete="name"
                maxLength={100}
                className="sm:flex-1"
              />
              <Button type="submit" disabled={!canSave} className="sm:w-auto">
                Save
              </Button>
            </div>
          </form>

          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">Email</div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
