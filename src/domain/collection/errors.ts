export class CollectionError extends Error {}

// Raised when an aggregate invariant would be violated (ddd/artefact-collections.md).
export class CollectionInvariantViolation extends CollectionError {}

// Raised when an operation targets a collection that does not exist or that the
// requester is not allowed to see — deliberately indistinguishable so a non-owner
// cannot probe for a collection's existence (collections.access.no-existence-leak, mirroring
// hosting.access.no-existence-leak).
export class CollectionNotFound extends CollectionError {}

// A restore refused because the item sits under an archived collection
// (collections.lifecycle.restore-under-active-parent): `message` gives the ids
// an agent needs, `namesOnly` is the web app's copy.
export class RestoreUnderArchivedCollection extends CollectionInvariantViolation {
  constructor(
    readonly item: { kind: "collection" | "artefact"; id: string; name: string },
    readonly archived: { id: string; name: string },
  ) {
    super(
      `${item.kind} '${item.id}' sits under an archived collection: restore '${archived.id}' (${archived.name}) instead, which restores this one with it — nothing was restored`,
    );
  }

  get namesOnly(): string {
    return `“${this.item.name}” is inside the archived collection “${this.archived.name}”: restore “${this.archived.name}” to bring it back.`;
  }
}
