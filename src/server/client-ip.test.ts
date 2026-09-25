import { describe, expect, it } from "vitest";
import { parseTrustedProxies, resolveClientIp } from "./client-ip";

// S42 — Trusted-proxy client address (IA8): the client address is resolved once,
// and only a trusted proxy may name it.

describe("parseTrustedProxies (S42)", () => {
  it("unset and empty give the default set: loopback, private and link-local", () => {
    for (const value of [undefined, "", "  "]) {
      const trusted = parseTrustedProxies(value);
      for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "fd00::1", "fe80::1"]) {
        expect(trusted.has(ip), ip).toBe(true);
      }
      for (const ip of ["198.51.100.4", "172.32.0.1", "8.8.8.8", "2001:db8::1", "100.64.0.1"]) {
        expect(trusted.has(ip), ip).toBe(false);
      }
    }
  });

  it("a set value replaces the default", () => {
    const trusted = parseTrustedProxies("203.0.113.0/24, 2001:db8::1");
    expect(trusted.has("203.0.113.7")).toBe(true);
    expect(trusted.has("2001:db8::1")).toBe(true);
    expect(trusted.has("2001:db8::2")).toBe(false);
    expect(trusted.has("10.0.0.1")).toBe(false);
  });

  it("an invalid entry throws, naming the entry", () => {
    expect(() => parseTrustedProxies("10.0.0.0/33")).toThrow(/10\.0\.0\.0\/33/);
    expect(() => parseTrustedProxies("proxy.local")).toThrow(/proxy\.local/);
    expect(() => parseTrustedProxies("10.0.0.0/8, ::1/129")).toThrow(/::1\/129/);
    expect(() => parseTrustedProxies("10.0.0.0/x")).toThrow(/10\.0\.0\.0\/x/);
  });
});

describe("resolveClientIp under the default set (S42)", () => {
  const trusted = parseTrustedProxies(undefined);

  it("a public peer cannot forge its address: the header is ignored", () => {
    expect(resolveClientIp("1.2.3.4", "198.51.100.9", trusted)).toBe("198.51.100.9");
  });

  it("behind a trusted proxy, the proxy-appended hop wins over the client-sent one", () => {
    expect(resolveClientIp("203.0.113.9, 198.51.100.4", "10.0.1.5", trusted)).toBe("198.51.100.4");
  });

  it("an IPv4-mapped IPv6 peer is matched as its IPv4 form", () => {
    expect(resolveClientIp("198.51.100.4", "::ffff:10.0.1.5", trusted)).toBe("198.51.100.4");
    expect(resolveClientIp(undefined, "::ffff:198.51.100.9", trusted)).toBe("198.51.100.9");
  });

  it("no header yields the peer; no socket and no header yields \"unknown\"", () => {
    expect(resolveClientIp(undefined, "10.0.1.5", trusted)).toBe("10.0.1.5");
    expect(resolveClientIp(undefined, undefined, trusted)).toBe("unknown");
    expect(resolveClientIp("198.51.100.4", undefined, trusted)).toBe("unknown");
  });

  it("trusted hops are skipped", () => {
    expect(resolveClientIp("198.51.100.4, 10.0.2.2", "10.0.1.5", trusted)).toBe("198.51.100.4");
  });

  it("when every hop is trusted, the leftmost is returned", () => {
    expect(resolveClientIp("10.0.2.2, 10.0.3.3", "10.0.1.5", trusted)).toBe("10.0.2.2");
  });

  it("an unparsable or empty hop never becomes the key", () => {
    expect(resolveClientIp("198.51.100.4, garbage", "10.0.1.5", trusted)).toBe("10.0.1.5");
    expect(resolveClientIp("198.51.100.4, , 10.0.2.2", "10.0.1.5", trusted)).toBe("10.0.2.2");
    expect(resolveClientIp("", "10.0.1.5", trusted)).toBe("10.0.1.5");
  });
});
