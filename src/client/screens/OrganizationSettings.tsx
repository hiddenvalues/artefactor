import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, CircleAlert, MailPlus } from "lucide-react";
import type { OrgInvitation, OrganizationSettings as Settings } from "../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Skeleton } from "$lib/components/ui/skeleton";
import { InviteDialog, type InviteRefusal } from "$lib/components/InviteDialog";
import { MemberList } from "$lib/components/MemberList";
import { ROLE_LABEL } from "$lib/components/AccountMenu";
import { ApiError, api } from "$lib/api";
import { notify } from "$lib/toast";

const REFUSALS: readonly string[] = ["invalid-email", "outside-domains", "already-member", "already-invited"];

// What the caller may do here. Core decides it on the server
// (`identity.org-admin.owner-or-admin`); the screen only mirrors it.
// r[impl platform.org-settings.role-controls+2]
function controlsFor(s: Settings) {
  const administers = s.role === "owner" || s.role === "admin";
  return {
    rename: administers,
    revoke: administers,
    invite: administers && (s.inviteDomains?.length ?? 0) > 0,
  };
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; settings: Settings };

// S58 — Organization settings: the active org's name, owner, your role and
// members; for an owner or admin, renaming it, inviting people and revoking
// pending invitations (docs/design/templates/account-settings.md). Re-fetched
// whenever the active org changes.
export function OrganizationSettings({
  activeId,
  orgName,
  youId,
  onRenamed,
}: {
  // The active org's id and name from `/api/me`; a switch changes them.
  activeId: string;
  orgName: string;
  youId: string;
  // After a rename, so the shell re-reads `/api/me` and the top bar follows.
  onRenamed: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  // Every load and change belongs to the org that was active when it started;
  // an answer that lands after a switch is dropped.
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);

  const take = (gen: number, s: Settings) => {
    if (gen !== generation.current) return false;
    setLoad({ state: "ready", settings: s });
    return true;
  };

  // r[impl platform.org-settings.follows-active-org+2]
  useEffect(() => {
    const gen = ++generation.current;
    setLoad({ state: "loading" });
    setInviting(false);
    api.organization().then(
      (s) => {
        if (take(gen, s)) setDraft(s.name);
      },
      () => {
        if (gen === generation.current) setLoad({ state: "error" });
      },
    );
  }, [activeId, retry]);

  const settings = load.state === "ready" ? load.settings : null;

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const next = draft.trim();
    if (saving || !next || next === settings.name) return;
    const gen = generation.current;
    setSaving(true);
    try {
      const fresh = await api.renameOrganization(next);
      if (!take(gen, fresh)) return;
      // Settle the field on the saved name, unless it was edited meanwhile.
      setDraft((d) => (d.trim() === next ? fresh.name : d));
      notify("Organization renamed", Check);
      onRenamed();
    } catch {
      notify("Couldn’t rename the organization", CircleAlert);
    } finally {
      setSaving(false);
    }
  }

  async function invite(email: string): Promise<InviteRefusal | null> {
    const gen = generation.current;
    try {
      const fresh = await api.inviteToOrganization(email);
      if (take(gen, fresh)) {
        setInviting(false);
        notify(`Invitation sent to ${email}`, Check);
      }
      return null;
    } catch (err) {
      if (err instanceof ApiError && REFUSALS.includes(err.message)) return err.message as InviteRefusal;
      notify("Couldn’t send the invitation", CircleAlert);
      return null;
    }
  }

  async function revoke(inv: OrgInvitation) {
    const gen = generation.current;
    try {
      if (take(gen, await api.revokeInvitation(inv.id))) notify(`Invitation to ${inv.email} revoked`, Check);
    } catch {
      notify("Couldn’t revoke the invitation", CircleAlert);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Organization settings</h1>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">{settings?.name ?? orgName}</p>

      {load.state === "loading" && (
        <div className="mt-6 flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      )}

      {load.state === "error" && (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">Couldn’t load the organization.</p>
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Ready
          settings={settings}
          youId={youId}
          draft={draft}
          saving={saving}
          onDraft={setDraft}
          onRename={(e) => void rename(e)}
          onInvite={() => setInviting(true)}
          onRevoke={(inv) => void revoke(inv)}
        />
      )}

      {settings && inviting && (
        <InviteDialog domains={settings.inviteDomains ?? []} onSend={invite} onClose={() => setInviting(false)} />
      )}
    </div>
  );
}

function Ready({
  settings,
  youId,
  draft,
  saving,
  onDraft,
  onRename,
  onInvite,
  onRevoke,
}: {
  settings: Settings;
  youId: string;
  draft: string;
  saving: boolean;
  onDraft: (name: string) => void;
  onRename: (e: FormEvent) => void;
  onInvite: () => void;
  onRevoke: (inv: OrgInvitation) => void;
}) {
  const can = controlsFor(settings);
  const owner = settings.owner.name || settings.owner.email;
  const next = draft.trim();
  const canSave = !saving && next !== "" && next !== settings.name;

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {can.rename ? (
            <form onSubmit={onRename} className="flex flex-col gap-2">
              <Label htmlFor="organization-name">Organization name</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="organization-name"
                  value={draft}
                  onChange={(e) => onDraft(e.target.value)}
                  maxLength={100}
                  className="sm:flex-1"
                />
                <Button type="submit" disabled={!canSave} className="sm:w-auto">
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <Row label="Name">{settings.name}</Row>
          )}
          <Row label="Owner">
            {owner}
            {settings.owner.name && settings.owner.email && (
              <span className="text-muted-foreground"> · {settings.owner.email}</span>
            )}
          </Row>
          <Row label="Your role">
            <Badge variant="secondary">{ROLE_LABEL[settings.role]}</Badge>
          </Row>
          {!can.rename && (
            <p className="text-sm text-muted-foreground">
              Only owners can rename the organization or invite and remove members. Ask {owner} if something
              needs changing.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Members · {settings.members.length}</h2>
        {can.invite && (
          <Button variant="outline" size="sm" onClick={onInvite}>
            <MailPlus />
            Invite people
          </Button>
        )}
      </div>
      <MemberList
        members={settings.members}
        youId={youId}
        invitations={settings.invitations}
        onRevoke={can.revoke ? onRevoke : undefined}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="min-w-0 truncate text-sm">{children}</div>
    </div>
  );
}
