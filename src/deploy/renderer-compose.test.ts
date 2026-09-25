import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// S37 (AH29) — the renderer-VM Compose file is the reviewed source both runbooks
// paste into Coolify. It must keep every hardening key of the example's renderer,
// and differ only where a dedicated VM behind an outside firewall needs it to:
// a host-created network via `network_mode` (so Coolify injects none of its own),
// a port published on the private address only, the seccomp profile by absolute
// path, and `pull_policy: always` (Coolify's deploy webhook never pulls otherwise).

const ROOT = resolve(import.meta.dirname, "../..");
const DEPLOY = join(ROOT, "deploy");
const VM_FILE = "docker-compose.renderer-vm.yml";

type Service = Record<string, unknown>;

function servicesOf(file: string): Record<string, Service> {
  const doc = parse(readFileSync(join(DEPLOY, file), "utf8")) as { services?: Record<string, Service> };
  return doc.services ?? {};
}

function rendererOf(services: Record<string, Service>): Service {
  const renderer = services.renderer;
  if (!renderer) throw new Error("no `renderer` service");
  return renderer;
}

const example = rendererOf(servicesOf("docker-compose.example.yml"));
const vmServices = servicesOf(VM_FILE);
const vm = rendererOf(vmServices);

const envOf = (service: Service): Record<string, unknown> => {
  const env = service.environment;
  if (Array.isArray(env)) {
    return Object.fromEntries(env.map((entry: string) => [entry.split("=")[0], entry.split("=").slice(1).join("=")]));
  }
  return (env as Record<string, unknown>) ?? {};
};
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const homeTmpfs = (service: Service) => list(service.tmpfs).find((entry) => entry.startsWith("/home/node"));

describe("deploy/docker-compose.renderer-vm.yml (S37, AH29)", () => {
  it("is the only renderer-VM Compose file, holding only the renderer service", () => {
    expect(readdirSync(DEPLOY).filter((name) => /renderer-vm/.test(name))).toEqual([VM_FILE]);
    expect(Object.keys(vmServices)).toEqual(["renderer"]);
  });

  it.each(["user", "read_only", "cap_drop", "pids_limit", "restart"])(
    "keeps the example renderer's %s",
    (key) => {
      expect(example[key]).toBeDefined();
      expect(vm[key]).toEqual(example[key]);
    },
  );

  it("keeps no-new-privileges, the /home/node tmpfs and ARTEFACTOR_ROLE", () => {
    expect(list(example.security_opt)).toContain("no-new-privileges:true");
    expect(list(vm.security_opt)).toContain("no-new-privileges:true");
    expect(homeTmpfs(example)).toBeDefined();
    expect(homeTmpfs(vm)).toEqual(homeTmpfs(example));
    expect(envOf(vm).ARTEFACTOR_ROLE).toEqual(envOf(example).ARTEFACTOR_ROLE);
  });

  it("joins the host-created network through network_mode, and no Compose network", () => {
    expect(vm.network_mode).toBe("artefactor-renderer");
    expect(vm).not.toHaveProperty("networks");
  });

  it("pulls on every compose up", () => {
    expect(vm.pull_policy).toBe("always");
  });

  it("publishes 3001 on an explicit host address only", () => {
    const ports = list(vm.ports);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port).toMatch(/^(\d{1,3}(\.\d{1,3}){3}|\$\{[A-Z_][A-Z0-9_]*(:?[?-][^}]*)?\}):3001:3001$/);
      expect(port).not.toMatch(/0\.0\.0\.0|::/);
    }
  });

  it("mounts no volume and carries no secret, database or storage setting", () => {
    expect(vm).not.toHaveProperty("volumes");
    for (const key of Object.keys(envOf(vm))) {
      expect(key).not.toMatch(/secret|token|password|database|dir$/i);
    }
  });

  it("names a seccomp profile by absolute path, and is never unconfined", () => {
    const opts = list(vm.security_opt);
    const seccomp = opts.filter((opt) => opt.startsWith("seccomp"));
    expect(seccomp).toHaveLength(1);
    const path = (seccomp[0] ?? "").replace(/^seccomp[=:]/, "");
    expect(isAbsolute(path)).toBe(true);
    expect(opts.join(" ")).not.toMatch(/unconfined/);
  });
});
