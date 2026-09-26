import type { CSSProperties, ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

// The theme itself, drawn from the tokens in app.css alone: colours and product
// colours (light and dark), type, radius and a few components in use. Design-only
// — the catalog and the Claude design sync show it; the app never imports it.
// Every colour is read as `var(--…)` through a custom-property style, so a
// `:root` / `.dark` override restyles it, and the app's Tailwind gains no
// per-token classes.

export type ThemeSection = "colours" | "product" | "type" | "radius" | "in-use";

/** A background token and the foreground drawn on it. */
const PAIRS = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  // No destructive-foreground: destructive is drawn as text on the background.
  ["background", "destructive"],
  ["sidebar", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
  ["sidebar-accent", "sidebar-accent-foreground"],
] as const;

/** The line tokens, each drawn the way the app uses it. */
const LINES = [
  ["border", "border"],
  ["input", "field"],
  ["ring", "ring"],
  ["sidebar-border", "border"],
  ["sidebar-ring", "ring"],
] as const;

const KINDS = ["prototype", "slide-deck", "form", "interactive-doc", "other"] as const;
const COLLECTIONS = [1, 2, 3, 4, 5, 6] as const;

const SIZES = [
  ["text-xs", "12px"],
  ["text-sm", "14px"],
  ["text-base", "16px"],
  ["text-lg", "18px"],
  ["text-xl", "20px"],
  ["text-2xl", "24px"],
] as const;

const RADII = [
  ["rounded-sm", "--radius − 4px"],
  ["rounded-md", "--radius − 2px"],
  ["rounded-lg", "--radius"],
  ["rounded-xl", "--radius + 4px"],
  ["rounded-full", "full"],
] as const;

const BUTTONS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const BADGES = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

const token = (name: string) => `var(--${name})`;

function Caption({ children }: { children: ReactNode }) {
  return <div className="font-mono text-xs text-muted-foreground">{children}</div>;
}

/**
 * Light | Dark, side by side once the specimen is wide enough (a container
 * query, so a narrow card cell stacks them). The dark column is the same
 * content under `.dark`; app.css has no `.light` class, so with the catalog's
 * dark toggle on both columns render dark.
 */
function LightDark({ children }: { children: ReactNode }) {
  return (
    <div className="grid w-full gap-4 @2xl:grid-cols-2">
      <div data-column="light" className="flex flex-col gap-3 rounded-lg border bg-background p-4 text-foreground">
        <div className="text-sm font-semibold">Light</div>
        {children}
      </div>
      <div data-column="dark" className="dark flex flex-col gap-3 rounded-lg border bg-background p-4 text-foreground">
        <div className="text-sm font-semibold">Dark</div>
        {children}
      </div>
    </div>
  );
}

function Colours() {
  return (
    <LightDark>
      <div className="grid grid-cols-2 gap-2">
        {PAIRS.map(([bg, fg]) => (
          <div
            key={`${bg}/${fg}`}
            data-swatch={fg === "destructive" ? fg : bg}
            style={{ "--swatch": token(bg), "--swatch-fg": token(fg) } as CSSProperties}
            className="flex min-h-16 flex-col justify-between gap-1 rounded-md border bg-(--swatch) p-2 text-xs text-(--swatch-fg)"
          >
            <span className="font-medium">Aa</span>
            <span className="font-mono break-words">{fg === "destructive" ? "destructive on background" : `${bg} / ${fg}`}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {LINES.map(([name, as]) => (
          <div key={name} data-line={name} className="flex flex-col gap-1" style={{ "--swatch": token(name) } as CSSProperties}>
            {as === "border" && <div className="h-9 rounded-md border-2 border-(--swatch)" />}
            {as === "field" && <div className="h-9 rounded-md border border-(--swatch) bg-transparent" />}
            {as === "ring" && <div className="h-9 rounded-md border ring-[3px] ring-(--swatch)" />}
            <Caption>{name}</Caption>
          </div>
        ))}
      </div>
    </LightDark>
  );
}

function Product() {
  return (
    <LightDark>
      <div className="flex flex-col gap-2">
        {KINDS.map((kind) => (
          <div
            key={kind}
            data-kind={kind}
            className="flex items-center gap-3"
            style={{ "--swatch": token(`kind-${kind}`), "--swatch-tint": token(`kind-${kind}-tint`) } as CSSProperties}
          >
            <div className="size-8 rounded-md bg-(--swatch)" />
            <div className="size-8 rounded-md bg-(--swatch-tint)" />
            <span className="rounded-full bg-(--swatch-tint) px-2 py-0.5 text-xs font-medium text-(--swatch)">{kind}</span>
            <Caption>--kind-{kind}</Caption>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {COLLECTIONS.map((n) => (
          <div key={n} data-collection={n} className="flex flex-col items-center gap-1" style={{ "--swatch": token(`collection-${n}`) } as CSSProperties}>
            <div className="size-8 rounded-md bg-(--swatch)" />
            <Caption>--collection-{n}</Caption>
          </div>
        ))}
      </div>
    </LightDark>
  );
}

function Type() {
  return (
    <div className="flex w-full flex-col gap-3">
      {SIZES.map(([size, px]) => (
        <div key={size} className="flex flex-col">
          <Caption>
            font-sans {size} · {px}
          </Caption>
          <div className={`font-sans ${size}`}>The quick brown fox jumps over the lazy dog</div>
        </div>
      ))}
      <div className="flex flex-col">
        <Caption>font-mono text-sm</Caption>
        <div className="font-mono text-sm">const artefact = await publish(html);</div>
      </div>
    </div>
  );
}

function Radius() {
  return (
    <div className="flex w-full flex-col gap-3">
      <Caption>--radius drives rounded-sm, md, lg and xl.</Caption>
      <div className="flex flex-wrap gap-4">
        {RADII.map(([cls, from]) => (
          <div key={cls} className="flex flex-col items-center gap-1">
            <div className={`size-16 border-2 border-primary bg-muted ${cls}`} />
            <Caption>{cls}</Caption>
            <Caption>{from}</Caption>
          </div>
        ))}
      </div>
    </div>
  );
}

function InUse() {
  return (
    <LightDark>
      <div className="flex flex-wrap gap-2">
        {BUTTONS.map((v) => (
          <Button key={v} size="sm" variant={v}>
            {v}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {BADGES.map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Label>Title</Label>
        <Input placeholder="Onboarding flow" />
      </div>
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle>Onboarding flow</CardTitle>
          <CardDescription>A clickable prototype.</CardDescription>
        </CardHeader>
        <CardContent className="px-4 text-sm">Last updated 3 hours ago.</CardContent>
        <CardFooter className="px-4">
          <Button size="sm">Open</Button>
        </CardFooter>
      </Card>
    </LightDark>
  );
}

const SECTIONS: Record<ThemeSection, () => ReactNode> = {
  colours: Colours,
  product: Product,
  type: Type,
  radius: Radius,
  "in-use": InUse,
};

export function ThemeSpecimen({ section }: { section: ThemeSection }) {
  const Section = SECTIONS[section];
  return (
    <div data-slot="theme-specimen" data-section={section} className="@container flex w-full max-w-4xl">
      <Section />
    </div>
  );
}
