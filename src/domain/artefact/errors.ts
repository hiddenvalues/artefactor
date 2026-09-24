export class DomainError extends Error {}

// Raised when an aggregate invariant would be violated.
export class InvariantViolation extends DomainError {}

// Raised when an operation targets an artefact that does not exist or that the
// requester is not allowed to see — the two are deliberately indistinguishable
// so a non-owner cannot probe for the existence of a private artefact (AH8).
export class ArtefactNotFound extends DomainError {}

// S35 (AH25) — the thumbnail renderer cannot run in this process (e.g. Chromium
// is not installed). Cards then show the kind placeholder; nothing else changes.
export class ThumbnailRendererUnavailable extends Error {
  constructor(message = "thumbnail renderer unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThumbnailRendererUnavailable";
  }
}

// S32a (AH22/AH24) — the matrix admits the viewer, but the artefact's link gate
// asks them for its password first. Raised only after a grant, so it never
// reveals anything a denied probe could not already see.
export class LinkGateChallenge extends DomainError {
  constructor(ref: string) {
    super(`${ref}: this link is password protected — open it in a browser to unlock it`);
  }
}
