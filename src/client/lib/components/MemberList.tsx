import { Mail, X } from "lucide-react";
import type { OrgInvitation, OrgMember } from "../../../shared/contracts";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Card } from "$lib/components/ui/card";
import { initials, relativeTime } from "../format";
import { ROLE_LABEL } from "./AccountMenu";

// S58 — the people in an organization, one row each, then (for those who
// administer it) the pending invitations with their revoke buttons. The caller
// passes them already ordered, owners first.
export function MemberList({
  members,
  youId,
  invitations = [],
  onRevoke,
}: {
  members: OrgMember[];
  // The signed-in user's id: their row reads "(you)".
  youId: string;
  // Pending invitations; shown only with `onRevoke`.
  invitations?: OrgInvitation[];
  onRevoke?: (invitation: OrgInvitation) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {members.map((m) => {
          const shown = m.name || m.email;
          return (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="shrink-0">
                <AvatarFallback className="text-xs font-semibold">{initials(shown)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {shown}
                  {m.id === youId && <span className="font-normal text-muted-foreground"> (you)</span>}
                </div>
                <div className="truncate text-sm text-muted-foreground">{m.email}</div>
              </div>
              <Badge variant={m.role === "member" ? "outline" : "secondary"} className="shrink-0">
                {ROLE_LABEL[m.role]}
              </Badge>
            </li>
          );
        })}
        {onRevoke &&
          invitations.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar className="shrink-0">
                <AvatarFallback>
                  <Mail className="size-4 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{inv.email}</div>
                <div className="truncate text-sm text-muted-foreground">Invited {relativeTime(inv.sentAt)}</div>
              </div>
              <Badge variant="outline" className="shrink-0">
                Pending
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                title={`Revoke invitation to ${inv.email}`}
                aria-label={`Revoke invitation to ${inv.email}`}
                onClick={() => onRevoke(inv)}
              >
                <X />
              </Button>
            </li>
          ))}
      </ul>
    </Card>
  );
}
