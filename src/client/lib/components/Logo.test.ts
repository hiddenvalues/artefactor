import { createElement, type MouseEvent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Logo, type LogoProps } from "./Logo";

// S77 — Logo: the gem jar mark, a narrow form and an optional link.
const html = (props: LogoProps = {}) => renderToStaticMarkup(createElement(Logo, props));

/** The class list of the first tag in `markup` that `pattern` matches. */
const classesOf = (markup: string, pattern: RegExp) => {
  const tag = pattern.exec(markup)?.[0];
  if (!tag) throw new Error(`no ${pattern} in ${markup}`);
  return /class="([^"]*)"/.exec(tag)?.[1]?.split(" ") ?? [];
};
const nameClasses = (markup: string) => {
  const span = /<span class="([^"]*)">Artefactor<\/span>/.exec(markup);
  if (!span) throw new Error(`no name in ${markup}`);
  return span[1]!.split(" ");
};

const link = { href: "/", label: "Artefactor, go to Home" };

/** A click as React hands it to the handler, recording `preventDefault`. */
const click = (
  init: Partial<Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">> = {},
) => {
  const event = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...init,
    preventDefault: vi.fn(),
  };
  return event as typeof event & MouseEvent<HTMLAnchorElement>;
};
// Logo has no hooks, so calling it gives the root element and its handler.
const onClickOf = (props: LogoProps) =>
  (Logo(props) as ReactElement<{ onClick: (event: MouseEvent<HTMLAnchorElement>) => void }>).props.onClick;

describe("Logo", () => {
  // r[verify platform.client.logo-link]
  it("without a destination is one non-focusable image named Artefactor", () => {
    const markup = html();
    expect(markup).toMatch(/^<div role="img" aria-label="Artefactor" class="[^"]*">/);
    expect(markup.match(/role="img"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<a\b|<button\b|tabindex|href=/);
  });

  // r[verify platform.client.logo-link]
  it("with a destination is one link named by its label, wrapping the tile and the name", () => {
    const markup = html(link);
    expect(markup).toMatch(/^<a href="\/" aria-label="Artefactor, go to Home" class="[^"]*">.*<svg.*Artefactor<\/span><\/a>$/);
    expect(markup.match(/<a\b/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<button\b|tabindex|role=/);
  });

  // r[verify platform.client.logo-link]
  it("names a link without a label Artefactor", () => {
    expect(html({ href: "/" })).toMatch(/^<a href="\/" aria-label="Artefactor"/);
  });

  // r[verify platform.client.logo-link]
  it("hides the mark from assistive technology in both forms", () => {
    for (const props of [{}, link]) expect(html(props)).toMatch(/<svg [^>]*aria-hidden="true"/);
  });

  it("draws the gem jar mark on a 32×32 grid in currentColor alone", () => {
    for (const props of [{}, link]) {
      const markup = html(props);
      expect(markup.match(/<svg\b/g)).toHaveLength(1);
      expect(markup).toMatch(/<svg [^>]*viewBox="0 0 32 32"/);
      expect(markup).not.toContain("0 0 24 24");
      const paints = [...markup.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]);
      expect(paints.length).toBeGreaterThan(0);
      expect(paints.filter((paint) => paint !== "currentColor" && paint !== "none")).toEqual([]);
      expect(markup).toMatch(/<path d="M12 6H7C6\.44772 6 6 6\.44772 6 7V25/);
      expect(markup.match(/<circle\b/g)).toHaveLength(3);
    }
  });

  // r[verify platform.client.logo-link]
  it("hands a plain click to onNavigate instead of following the link", () => {
    const onNavigate = vi.fn();
    const event = click();
    onClickOf({ ...link, onNavigate })(event);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  // r[verify platform.client.logo-link]
  it.each([
    ["⌘", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["middle", { button: 1 }],
  ])("leaves a %s click to the browser", (_, init) => {
    const onNavigate = vi.fn();
    const event = click(init);
    onClickOf({ ...link, onNavigate })(event);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // r[verify platform.client.logo-link]
  it("leaves a click something else already prevented alone", () => {
    const onNavigate = vi.fn();
    const event = click({ defaultPrevented: true });
    onClickOf({ ...link, onNavigate })(event);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // r[verify platform.client.logo-link]
  it("follows the link on a plain click when no onNavigate is given", () => {
    const event = click();
    onClickOf(link)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // r[verify platform.client.logo-link]
  it("rings the whole link on keyboard focus, and the plain logo not at all", () => {
    const ring = ["outline-none", "focus-visible:ring-[3px]", "focus-visible:ring-ring/50", "rounded-md"];
    expect(classesOf(html(link), /^<a [^>]*>/)).toEqual(expect.arrayContaining(ring));
    expect(html()).not.toMatch(/focus|hover|ring/);
  });

  // r[verify platform.client.logo-narrow+2]
  it("hides the top-bar name while the top bar is narrower than sm, leaving no gap", () => {
    for (const props of [{}, link]) {
      const markup = html(props);
      expect(nameClasses(markup)).toEqual(
        expect.arrayContaining(["hidden", "@min-[40rem]/top-bar:inline", "@min-[40rem]/top-bar:ml-2.5"]),
      );
      expect(nameClasses(markup).filter((c) => c.startsWith("sm:"))).toEqual([]);
      expect(nameClasses(markup)).not.toContain("ml-2.5");
      expect(classesOf(markup, /^<(a|div) [^>]*>/).filter((c) => c.includes("gap"))).toEqual([]);
    }
    expect(html(link)).toMatch(/aria-label="Artefactor, go to Home"/);
  });

  // r[verify platform.client.logo-narrow+2]
  it("always shows the large name", () => {
    expect(nameClasses(html({ size: "lg" })).filter((c) => /hidden|^sm:|^@/.test(c))).toEqual([]);
    expect(nameClasses(html({ size: "lg" }))).toContain("ml-2.5");
  });

  it("hugs its content in both forms, so the image is no wider than the mark and name", () => {
    for (const props of [{}, link]) expect(classesOf(html(props), /^<(a|div) [^>]*>/)).toContain("w-fit");
  });

  it.each([
    ["md", "size-7", "size-4", "text-[15px]"],
    ["lg", "size-8", "size-4.5", "text-lg"],
  ] as const)("sizes %s as a %s tile, a %s icon and a %s name", (size, tile, icon, name) => {
    const markup = html({ size });
    expect(classesOf(markup, /<span class="[^"]*bg-primary[^"]*">/)).toContain(tile);
    expect(classesOf(markup, /<svg [^>]*>/)).toContain(icon);
    expect(nameClasses(markup)).toContain(name);
  });
});
