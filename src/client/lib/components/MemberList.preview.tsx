import { definePreview } from "../../design/preview";
import { noop, viewer } from "../../design/fixtures";
import type { OrgInvitation, OrgMember } from "../../../shared/contracts";
import { cn } from "../utils";
import { MemberList } from "./MemberList";

// S58 — the Organization settings member list, owners first.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const owner: OrgMember = { ...viewer, role: "owner" };
const team: OrgMember[] = [
  owner,
  { id: "user-grace", name: "Grace Hopper", email: "grace@example.com", role: "admin" },
  { id: "user-katherine", name: "Katherine Johnson", email: "katherine.johnson@example.com", role: "member" },
];
const pending: OrgInvitation[] = [
  { id: "inv-1", email: "margaret@example.com", sentAt: daysAgo(2) },
  { id: "inv-2", email: "a.very.long.address.for.someone@example.com", sentAt: daysAgo(9) },
];
const asMember: OrgMember[] = [
  { id: "user-grace", name: "Grace Hopper", email: "grace@example.com", role: "owner" },
  { ...viewer, role: "member" },
];

function Example({ width = "w-full", ...props }: Parameters<typeof MemberList>[0] & { width?: string }) {
  return (
    <div className={cn("max-w-full", width)}>
      <MemberList {...props} />
    </div>
  );
}

export default definePreview({
  title: "Member list",
  variants: [
    {
      name: "Owner, with pending invitations",
      render: () => <Example members={team} youId={viewer.id} invitations={pending} onRevoke={noop} />,
    },
    { name: "Owner, none pending", render: () => <Example members={team} youId={viewer.id} invitations={[]} onRevoke={noop} /> },
    { name: "Member (read-only)", render: () => <Example members={asMember} youId={viewer.id} /> },
    { name: "Personal organization", render: () => <Example members={[owner]} youId={viewer.id} onRevoke={noop} /> },
    {
      name: "Narrow",
      render: () => <Example members={team} youId={viewer.id} invitations={pending} onRevoke={noop} width="w-[20rem]" />,
    },
  ],
});
