import type { ViewEntry } from "./view-entry";
import type { OwnViewRef, ViewerRef, ViewRepository } from "./view-repository";

// In-memory implementation of the ViewRepository port — the TDD double for the
// view-tracking slice (S21). Keyed by (artefactId, viewerId) to enforce
// one-entry-per-pair (views.entry.one-per-pair).
export class InMemoryViewRepository implements ViewRepository {
  private readonly store = new Map<string, ViewEntry>();

  private key(artefactId: string, viewerId: string): string {
    return `${artefactId} ${viewerId}`;
  }

  async findByArtefactAndViewer(
    artefactId: string,
    viewerId: string,
  ): Promise<ViewEntry | null> {
    const found = this.store.get(this.key(artefactId, viewerId));
    return found ? { ...found } : null;
  }

  async save(entry: ViewEntry): Promise<void> {
    this.store.set(this.key(entry.artefactId, entry.viewerId), { ...entry });
  }

  async listViewersByArtefact(artefactId: string): Promise<ViewerRef[]> {
    return [...this.store.values()]
      .filter((e) => e.artefactId === artefactId)
      .map((e) => ({ viewerId: e.viewerId, viewedAt: e.viewedAt }));
  }

  async listByViewer(viewerId: string): Promise<OwnViewRef[]> {
    return [...this.store.values()]
      .filter((e) => e.viewerId === viewerId)
      .sort((x, y) => y.viewedAt.getTime() - x.viewedAt.getTime())
      .map((e) => ({ artefactId: e.artefactId, viewedAt: e.viewedAt }));
  }

  async deleteByArtefact(artefactId: string): Promise<void> {
    for (const [k, e] of this.store) {
      if (e.artefactId === artefactId) this.store.delete(k);
    }
  }
}
