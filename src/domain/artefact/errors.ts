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
