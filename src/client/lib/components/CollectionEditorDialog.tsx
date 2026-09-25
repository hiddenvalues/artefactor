import { useState } from "react";
import type { CollectionSummary } from "../../../shared/contracts";
import { Button } from "$lib/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { VIS, VIS_ORDER, type Visibility } from "../format";
import { ChoiceList } from "./ChoiceList";
import { FieldError } from "./UploadDialog";

const TIERS = VIS_ORDER.map((v) => ({ value: v, ...VIS[v] }));

// S25 — create / edit ("Rename & access") a collection. Access is chosen on tree
// roots only (CL4): a nested collection — created under a parent, or edited
// while nested — shows an inherit note instead of the tiers. Mounted per open.
export function CollectionEditorDialog({
  editing = null,
  parent = null,
  busy = false,
  serverError = null,
  onClose,
  onSubmit,
}: {
  editing?: CollectionSummary | null;
  parent?: CollectionSummary | null;
  busy?: boolean;
  serverError?: string | null;
  onClose: () => void;
  onSubmit: (input: { name: string; visibility?: Visibility }) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [visibility, setVisibility] = useState<Visibility>(editing?.visibility ?? "private");
  const [nameError, setNameError] = useState<string | null>(null);

  const isRoot = editing ? editing.parentId === null : parent === null;
  const title = editing ? "Rename & access" : parent ? "New sub-collection" : "New collection";
  const subtitle = editing
    ? "Update the name and access level."
    : parent
      ? `Inside “${parent.name}”`
      : "A new top-level collection.";

  function submit() {
    // Enter in the name field bypasses the disabled button.
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give your collection a name.");
      return;
    }
    setNameError(null);
    onSubmit({ name: trimmed, visibility: isRoot ? visibility : undefined });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="collection-name" className="mb-2">
              Name
            </Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q4 Experiments"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              aria-invalid={!!nameError}
            />
            {nameError && <FieldError>{nameError}</FieldError>}
          </div>

          {isRoot ? (
            <div>
              <div className="mb-2 text-sm font-medium">Access</div>
              <ChoiceList choices={TIERS} value={visibility} onChoose={setVisibility} bordered />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Artefacts and sub-collections inside inherit this access level.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              Access is inherited from the top-level collection — everything in the tree follows it.
            </div>
          )}

          {serverError && <FieldError>{serverError}</FieldError>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {editing ? "Save" : "Create collection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
