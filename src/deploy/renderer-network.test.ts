import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// S37 — the renderer's network layer, as the one-host deployment ships it: the
// example Compose file's two bridges and the host firewall rules of
// deploy/renderer-egress.sh that match them by name.

const DEPLOY = join(resolve(import.meta.dirname, "../.."), "deploy");
const egress = readFileSync(join(DEPLOY, "renderer-egress.sh"), "utf8");
const compose = parse(readFileSync(join(DEPLOY, "docker-compose.example.yml"), "utf8")) as {
  services: Record<string, { networks?: string[] }>;
  networks: Record<string, { internal?: boolean; driver_opts?: Record<string, string> }>;
};

// The space-separated value of `NAME="…"` in the script.
function setting(name: string): string[] {
  const match = new RegExp(`^${name}="([^"]*)"`, "m").exec(egress);
  if (!match) throw new Error(`no ${name} in renderer-egress.sh`);
  return match[1]!.split(/\s+/).filter(Boolean);
}

// The script's rule lines, continuation lines joined.
const rules = egress
  .replace(/\\\n\s*/g, "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("ensure "));

describe("renderer network isolation (S37)", () => {
  // r[verify hosting.renderer.no-private-network+2]
  it("drops new connections from the renderer's egress bridge to every private, loopback and link-local range", () => {
    expect(setting("PRIVATE_V4")).toEqual(
      expect.arrayContaining([
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
      ]),
    );
    expect(setting("PRIVATE_V6")).toEqual(expect.arrayContaining(["fc00::/7", "fe80::/10", "::1/128"]));
    expect(rules).toContain(
      'ensure iptables DOCKER-USER -i "$EGRESS_IF" -d "$net" -m conntrack --ctstate NEW -j DROP',
    );
    expect(rules).toContain(
      'ensure ip6tables DOCKER-USER -i "$EGRESS_IF" -d "$net" -m conntrack --ctstate NEW -j DROP',
    );
    // The host itself, reached through either bridge.
    for (const bridge of ["EGRESS_IF", "LINK_IF"]) {
      expect(rules).toContain(`ensure iptables INPUT -i "$${bridge}" -m conntrack --ctstate NEW -j DROP`);
    }
  });

  // r[verify hosting.renderer.no-app-connection]
  it("joins the app only on an internal, icc-off link that admits new connections to the renderer's port alone", () => {
    const link = compose.networks["artefactor-link"]!;
    expect(link.internal).toBe(true);
    expect(link.driver_opts?.["com.docker.network.bridge.enable_icc"]).toBe("false");

    // The app and the renderer share the link and nothing else.
    const app = compose.services.app!.networks ?? [];
    const renderer = compose.services.renderer!.networks ?? [];
    expect(renderer.filter((n) => app.includes(n))).toEqual(["artefactor-link"]);

    // On that link the only new connection the firewall accepts is one to the renderer's port.
    const linkAccepts = rules.filter((r) => r.includes('-i "$LINK_IF" -o "$LINK_IF"') && r.includes("NEW"));
    expect(linkAccepts).toEqual([
      'ensure iptables DOCKER-USER -i "$LINK_IF" -o "$LINK_IF" -p tcp --dport "$RENDERER_PORT" -m conntrack --ctstate NEW -j ACCEPT',
    ]);
  });
});
