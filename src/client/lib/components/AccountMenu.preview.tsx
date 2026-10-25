import { useStandalone } from "../../design/Launcher";
import { definePreview } from "../../design/preview";
import type { OrganizationContext } from "../../../shared/contracts";
import { memberOfSeveral, noop, ownerOfOne, viewer } from "../../design/fixtures";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

const longName: OrganizationContext = {
  activeId: "org-long",
  memberships: [{ id: "org-long", name: "The Very Long Organization Name Co. Ltd.", role: "admin" }],
};

function Example({
  organizations,
  variant = "default",
  open = false,
}: {
  // S53 — the org context a superset reports; none = OSS.
  organizations?: OrganizationContext;
  variant?: AccountMenuProps["variant"];
  open?: boolean;
}) {
  return (
    // Room below the button for the menu to open into, right-aligned as in the top bar.
    <div className="flex h-[26rem] justify-end">
      <AccountMenu
        user={{ ...viewer, organizations }}
        variant={variant}
        onSwitchOrganization={noop}
        onOpenAccount={noop}
        onOpenOrganization={noop}
        onSignOut={noop}
        switcherOpen={open}
      />
    </div>
  );
}

// Overlays can't all be open on the catalog page: these start open only on the
// standalone page (Launcher's primary-overlay rule).
function SeveralOrgs() {
  return <Example organizations={memberOfSeveral} open={useStandalone()} />;
}

// With one org there is no switcher, so `switcherOpen` opens just the menu.
function MenuOpen() {
  return <Example organizations={ownerOfOne} open={useStandalone()} />;
}

// S80 — Account menu as its own component (docs/design/components/account-menu.md).
export default definePreview({
  title: "Account menu",
  variants: [
    { name: "Owner of one organization", render: () => <Example organizations={ownerOfOne} /> },
    { name: "Several organizations, switcher open", render: () => <SeveralOrgs /> },
    { name: "Long organization name", render: () => <Example organizations={longName} /> },
    { name: "Avatar variant", render: () => <Example organizations={ownerOfOne} variant="avatar" /> },
    { name: "No organization (OSS)", render: () => <Example /> },
    { name: "Menu open", render: () => <MenuOpen /> },
  ],
});
