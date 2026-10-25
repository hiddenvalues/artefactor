export class CollectionError extends Error {}

// Raised when an aggregate invariant would be violated (ddd/artefact-collections.md).
export class CollectionInvariantViolation extends CollectionError {}

// Raised when an operation targets a collection that does not exist or that the
// requester is not allowed to see — deliberately indistinguishable so a non-owner
// cannot probe for a collection's existence (collections.access.no-existence-leak, mirroring
// hosting.access.no-existence-leak).
export class CollectionNotFound extends CollectionError {}
