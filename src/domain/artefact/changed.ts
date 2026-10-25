import type { Artefact } from "./artefact";

// The fields a transition may change. Identity, tenancy, creation time, the stamp itself, the
// repository's concurrency token and the derived thumbnail are never among them.
// r[impl hosting.artefact.identity-fixed]
// r[impl hosting.tenant.id-fixed]
export type OwnerChanges = Partial<
  Omit<
    Artefact,
    "id" | "ownerId" | "tenantId" | "createdAt" | "updatedAt" | "revision" | "thumbnailHash"
  >
>;

// The one site that stamps a change: every transition of the Artefact aggregate — the owner's, and
// a move into or out of a collection — builds its next aggregate here, so `updatedAt` always moves
// with it (hosting.artefact.updated-at-bumped).
// A request that changes nothing — every key `Object.is` the current value (so a rebuilt gate, list
// or date counts as a change), or no key at all — returns the input itself, so `mutateArtefact`
// skips the save; derived state (the thumbnail) is written by the repository without it. Kept apart
// from `artefact.ts` so `link-gate.ts`, which `artefact.ts` imports, can use it without an import
// cycle.
// r[impl hosting.artefact.updated-at-bumped+2]
export function changed(a: Artefact, changes: OwnerChanges, now: Date = new Date()): Artefact {
  const keys = Object.keys(changes) as (keyof OwnerChanges)[];
  if (keys.every((k) => Object.is(changes[k], a[k]))) return a;
  return { ...a, ...changes, updatedAt: now };
}
