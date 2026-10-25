import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrganizationContext } from "../../../shared/contracts";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

// S80 — Account menu as its own component: the button, rendered closed.
const noop = () => {};
const html = (organizations: OrganizationContext | undefined, variant: AccountMenuProps["variant"] = "default") =>
  renderToStaticMarkup(
    createElement(AccountMenu, {
      user: { name: "Ada Lovelace", email: "ada@example.com", organizations },
      variant,
      onSwitchOrganization: noop,
      onOpenAccount: noop,
      onOpenOrganization: noop,
      onSignOut: noop,
    }),
  );
const one = (name: string, role: "owner" | "admin" | "member"): OrganizationContext => ({
  activeId: "org-1",
  memberships: [{ id: "org-1", name, role }],
});
const buttons = (markup: string) => markup.match(/<button[^>]*>/g) ?? [];

describe("AccountMenu", () => {
  // r[verify platform.top-bar.org-and-role+2]
  it("names the default button by org and role, in its label and title, and shows the name, badge and chevron", () => {
    const markup = html(one("Hidden Value", "owner"));
    const [button] = buttons(markup);
    expect(buttons(markup)).toHaveLength(1);
    expect(button).toContain('aria-label="Account: Hidden Value, Owner"');
    expect(button).toContain('title="Account: Hidden Value, Owner"');
    expect(markup).toContain(">AL<");
    expect(markup).toContain(">Hidden Value</span>");
    expect(markup).toContain(">Owner</span>");
    expect(markup).toContain("lucide-chevron-down");
  });

  // r[verify platform.top-bar.org-and-role+2]
  it("reads Member on a member's badge", () => {
    const markup = html(one("Hidden Value", "member"));
    expect(markup).toContain('aria-label="Account: Hidden Value, Member"');
    expect(markup).toContain(">Member</span>");
  });

  // r[verify platform.top-bar.org-and-role+2]
  it("truncates a long org name at 10rem on the button and keeps it whole in the label and title", () => {
    const long = "The Very Long Organization Name Co. Ltd.";
    expect(long).toHaveLength(40);
    const markup = html(one(long, "admin"));
    expect(markup).toMatch(new RegExp(`<span class="[^"]*\\bmax-w-40\\b[^"]*\\btruncate\\b[^"]*">${long}</span>`));
    expect(markup).toContain(`aria-label="Account: ${long}, Admin"`);
    expect(markup).toContain(`title="Account: ${long}, Admin"`);
  });

  // r[verify platform.top-bar.org-and-role+2]
  it("is a round icon button holding only the avatar in the avatar variant, under the same name", () => {
    const markup = html(one("Hidden Value", "owner"), "avatar");
    const [button] = buttons(markup);
    expect(button).toContain('aria-label="Account: Hidden Value, Owner"');
    expect(button).toContain('title="Account: Hidden Value, Owner"');
    expect(button).toContain("rounded-full");
    expect(button).toContain('data-size="icon"');
    expect(button).toContain('data-variant="ghost"');
    expect(markup).not.toContain("Hidden Value</span>");
    expect(markup).not.toContain("lucide-chevron-down");
    expect(markup).toContain(">AL<");
  });

  // r[verify platform.top-bar.org-and-role+2]
  it("is the plain Account button without an org context, in both variants", () => {
    for (const variant of ["default", "avatar"] as const) {
      const [button] = buttons(html(undefined, variant));
      expect(button).toContain('aria-label="Account"');
      expect(button).toContain('title="Account"');
    }
  });
});
