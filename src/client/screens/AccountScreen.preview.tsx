import { noop, organization, ownerOfOne, viewer } from "../design/fixtures";
import { definePreview } from "../design/preview";
import { ScreenFrame } from "../design/ScreenFrame";
import { AccountScreen } from "./AccountScreen";
import { OrganizationSettings } from "./OrganizationSettings";

// S70 — the account menu's two screens inside the app frame
// (docs/design/templates/account-settings.md): Account (S57) and, with an org
// context, Organization settings (S58), whose settings the fixture API answers.
export default definePreview({
  title: "Account settings",
  variants: [
    {
      name: "Account",
      render: () => (
        <ScreenFrame view="account" organizations={ownerOfOne}>
          <AccountScreen user={viewer} onSaved={noop} />
        </ScreenFrame>
      ),
    },
    {
      name: "Organization",
      render: () => (
        <ScreenFrame view="organization" organizations={ownerOfOne}>
          <OrganizationSettings activeId={organization.id} orgName={organization.name} youId={viewer.id} onRenamed={noop} />
        </ScreenFrame>
      ),
    },
  ],
});
