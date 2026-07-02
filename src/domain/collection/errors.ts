export class CollectionError extends Error {}

// Raised when an aggregate invariant would be violated (CL1–CL9).
export class CollectionInvariantViolation extends CollectionError {}

// Raised when an operation targets a collection that does not exist or that the
// requester is not allowed to see — deliberately indistinguishable so a
// non-owner cannot probe for a collection's existence (CL10, mirroring AH8).
export class CollectionNotFound extends CollectionError {}
