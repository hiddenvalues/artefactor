import { DomainError, InvariantViolation } from "./errors";

// S23 — the enforcement policy seams the EE Usage & Quota context plugs into: a quota gate on
// create and payload-replacing edit, the payload-size cap and the badge on public serves. Each is a
// port with an OSS default that changes nothing (`ossEnforcement`); `createApp` takes the bundle as
// an injected dependency, as it does the access policy.

// Who a policy is asked about: the artefact's owner and the tenant it lives in (the tenant it is
// created in, on create).
export interface EnforcementContext {
  ownerId: string;
  tenantId: string;
}

export type QuotaDecision = "allow" | "warn" | "deny";

export interface QuotaVerdict {
  decision: QuotaDecision;
  // Required on a deny (quota.verdict.never-silent): why, and where to lift the limit (a URL or an
  // app path).
  reason?: string;
  upgradePath?: string;
  // Seconds; a rate fence sets it, and the BFF answers 429 with a Retry-After header.
  retryAfter?: number;
}

export interface QuotaPolicy {
  check(
    ctx: EnforcementContext & { action: "create" | "edit"; bytes: number },
  ): Promise<QuotaVerdict>;
}

export interface PayloadSizePolicy {
  maxBytes(ctx: EnforcementContext): Promise<number>;
}

export interface Badge {
  label: string;
  href: string;
}

export interface BrandingPolicy {
  badgeFor(ctx: EnforcementContext & { artefactId: string }): Promise<Badge | null>;
}

export interface EnforcementPolicies {
  quota: QuotaPolicy;
  payloadSize: PayloadSizePolicy;
  branding: BrandingPolicy;
}

// The OSS payload-size cap, and the ceiling no policy can lift (hosting.payload.cap-policy-decided).
export const DEFAULT_MAX_PAYLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const MB = 1024 * 1024;

// The smallest cap a policy can set. The payload-size policy sizes what may be stored, not
// whether anything may be: refusing every create is the quota's job, with a reason and an upgrade
// path. A floor in whole megabytes also keeps the cap message ("the N MB cap") meaningful.
export const MIN_PAYLOAD_CAP_BYTES = MB;

// r[impl hosting.payload.cap-policy-decided+2]
// The cap a payload is held to: the policy's value, in whole bytes, kept between 1 MB and the
// 100 MB ceiling. A value that isn't a finite number (NaN, Infinity, missing) is read as 100 MB.
export function effectivePayloadCap(policyCap: unknown): number {
  if (typeof policyCap !== "number" || !Number.isFinite(policyCap)) {
    return DEFAULT_MAX_PAYLOAD_BYTES;
  }
  return Math.min(DEFAULT_MAX_PAYLOAD_BYTES, Math.max(MIN_PAYLOAD_CAP_BYTES, Math.floor(policyCap)));
}

// The payload-size policy's cap for this owner and tenant, as effectivePayloadCap holds it. Every
// site that asks the policy goes through here.
export async function resolvePayloadCap(
  policies: EnforcementPolicies,
  ctx: EnforcementContext,
): Promise<number> {
  return effectivePayloadCap(await policies.payloadSize.maxBytes(ctx));
}

// The oversize message, naming the cap: "payload exceeds the 100 MB cap" under the OSS default.
export function capMessage(maxBytes: number): string {
  return `payload exceeds the ${Number((maxBytes / MB).toFixed(2))} MB cap`;
}

// r[impl platform.enforcement.oss-defaults+2]
// The OSS defaults: allow everything, cap at 100 MB, show no badge.
export const ossEnforcement: EnforcementPolicies = {
  quota: { check: async () => ({ decision: "allow" }) },
  payloadSize: { maxBytes: async () => DEFAULT_MAX_PAYLOAD_BYTES },
  branding: { badgeFor: async () => null },
};

// A quota deny: the command stops before anything is written, and the BFF answers 402 (429 when
// `retryAfter` is set) with the reason and the upgrade path.
export class QuotaDenied extends DomainError {
  constructor(
    readonly reason: string,
    readonly upgradePath: string,
    readonly retryAfter?: number,
  ) {
    super(reason);
  }
}

// r[impl platform.enforcement.warn-proceeds]
// `allow` and `warn` proceed; anything else is a deny, so a malformed verdict fails closed. A wait
// is whole seconds, at least one (an HTTP Retry-After's delay-seconds, never an invitation to retry
// at once, and never past a safe integer, which would print in exponent form); one that isn't a
// finite number is dropped. A deny always says why, even when the policy gives no reason.
export function assertQuotaAllows(verdict: QuotaVerdict): void {
  if (verdict.decision === "allow" || verdict.decision === "warn") return;
  const wait = verdict.retryAfter;
  throw new QuotaDenied(
    verdict.reason || "quota exceeded",
    verdict.upgradePath ?? "",
    wait !== undefined && Number.isFinite(wait)
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(wait)))
      : undefined,
  );
}

// r[impl platform.enforcement.quota-denies-create+2]
// The gate a create and a payload-replacing edit pass before anything is stored: the payload-size
// policy's cap (hosting.payload.cap-policy-decided), then the quota. Returns the cap, which the
// command hands the domain factory.
export async function enforcePayload(
  policies: EnforcementPolicies,
  ctx: EnforcementContext,
  action: "create" | "edit",
  bytes: number,
): Promise<number> {
  const maxBytes = await resolvePayloadCap(policies, ctx);
  if (bytes > maxBytes) throw new InvariantViolation(capMessage(maxBytes));
  assertQuotaAllows(await policies.quota.check({ ...ctx, action, bytes }));
  return maxBytes;
}
