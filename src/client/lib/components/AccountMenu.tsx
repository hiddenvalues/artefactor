import { useEffect, useRef, useState, type Ref } from "react";
import { Building2, ChevronDown, LogOut, Monitor, Moon, Palette, Settings, Sun, UserRound } from "lucide-react";
import type { OrganizationContext, OrgRole } from "../../../shared/contracts";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "$lib/components/ui/dropdown-menu";
import { initials } from "../format";
import { THEMES, useTheme, type Theme } from "../theme";

// S45 — the account menu's theme choice (S53: in its Colour theme submenu).
const THEME_OPTIONS: Record<Theme, { label: string; Icon: typeof Sun }> = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

// S53 — the role is shown as text, read-only; it grants nothing here.
export const ROLE_LABEL: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export interface AccountMenuProps {
  // S53 — `organizations` only when a superset supplies an org context.
  user: { name: string; email: string; organizations?: OrganizationContext };
  // S80 — `avatar` is the narrow form: the avatar alone, in a round icon button.
  variant: "default" | "avatar";
  // S53 — picking an org other than the active one.
  onSwitchOrganization: (organizationId: string) => void;
  // S57 — opens the Account screen.
  onOpenAccount: () => void;
  // S58 — opens Organization settings (offered only with an org context).
  onOpenOrganization: () => void;
  onSignOut: () => void;
  // S80 — the button, so a host can return focus to it (after a failed switch).
  triggerRef?: Ref<HTMLButtonElement>;
  // S53 — previews only: mount with the menu and its switcher open
  // (a standalone preview page's primary overlay, as `Launcher` does).
  switcherOpen?: boolean;
}

// S80 — the account entry point (docs/design/components/account-menu.md). It
// renders from `user` and reports actions; the host navigates and switches.
export function AccountMenu({
  user,
  variant,
  onSwitchOrganization,
  onOpenAccount,
  onOpenOrganization,
  onSignOut,
  triggerRef,
  switcherOpen = false,
}: AccountMenuProps) {
  const displayName = user.name || user.email;
  const { theme, setTheme } = useTheme();
  // The switcher submenu. A preview opens it once the menu has taken focus:
  // opened together, the menu's autofocus dismisses it.
  const [subOpen, setSubOpen] = useState(false);
  // S80 — after a switch pick the host decides where focus goes once the switch
  // settles, so the closing menu doesn't return it to the button.
  const switched = useRef(false);
  useEffect(() => {
    if (!switcherOpen) return;
    const t = setTimeout(() => setSubOpen(true), 100);
    return () => clearTimeout(t);
  }, [switcherOpen]);
  // S53 — the active membership, when there is an org context.
  const orgs = user.organizations;
  const active = orgs?.memberships.find((m) => m.id === orgs.activeId);
  // r[impl platform.top-bar.org-and-role+2]
  const accountLabel = active ? `Account: ${active.name}, ${ROLE_LABEL[active.role]}` : "Account";

  return (
    <DropdownMenu defaultOpen={switcherOpen}>
      <DropdownMenuTrigger ref={triggerRef} asChild>
        {variant === "avatar" ? (
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" title={accountLabel} aria-label={accountLabel}>
            <Avatar className="size-8">
              <AvatarFallback className="text-xs font-semibold">{initials(displayName)}</AvatarFallback>
            </Avatar>
          </Button>
        ) : (
          <Button variant="outline" className="shrink-0 gap-1.5 px-1.5" title={accountLabel} aria-label={accountLabel}>
            <Avatar className="size-6">
              <AvatarFallback className="text-[11px] font-semibold">{initials(displayName)}</AvatarFallback>
            </Avatar>
            {active && (
              <>
                <span className="max-w-40 truncate text-sm font-medium">{active.name}</span>{" "}
                <Badge variant="secondary">{ROLE_LABEL[active.role]}</Badge>
              </>
            )}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        )}
      </DropdownMenuTrigger>
      {/* r[impl platform.top-bar.account-menu+2] */}
      <DropdownMenuContent
        align="end"
        className="min-w-56"
        onCloseAutoFocus={(e) => {
          if (!switched.current) return;
          switched.current = false;
          e.preventDefault();
        }}
      >
        <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-semibold">{initials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </DropdownMenuLabel>
        {active && (
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{active.name}</span>{" "}
            <Badge variant="secondary">{ROLE_LABEL[active.role]}</Badge>
          </DropdownMenuLabel>
        )}
        {orgs && orgs.memberships.length > 1 && (
          <DropdownMenuSub open={subOpen} onOpenChange={setSubOpen}>
            <DropdownMenuSubTrigger>
              <Building2 />
              Switch organization
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-48">
              {orgs.memberships.map((m) => (
                <DropdownMenuCheckboxItem
                  key={m.id}
                  checked={m.id === orgs.activeId}
                  onSelect={() => {
                    if (m.id === orgs.activeId) return;
                    switched.current = true;
                    onSwitchOrganization(m.id);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {/* S57 — always present, OSS included. */}
        <DropdownMenuItem onSelect={onOpenAccount}>
          <UserRound />
          Account
        </DropdownMenuItem>
        {/* S58 — only with an org context. */}
        {orgs && (
          <DropdownMenuItem onSelect={onOpenOrganization}>
            <Settings />
            Organization settings
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette />
            Colour theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {THEMES.map((t) => {
                const { label, Icon } = THEME_OPTIONS[t];
                return (
                  <DropdownMenuRadioItem key={t} value={t}>
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
