import { useRef, useState, type DragEvent } from "react";
import { CircleAlert, FileText, Upload, X } from "lucide-react";
import type { ArtefactSummary } from "../../../shared/contracts";
import type { ArtefactKind } from "../../../domain/artefact/kind";
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
import { ToggleGroup, ToggleGroupItem } from "$lib/components/ui/toggle-group";
import { fmtBytes, KIND_ORDER, KINDS, VIS } from "../format";
import { kindVars } from "../style";
import { cn } from "../utils";

export function FieldError({ children }: { children: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />
      {children}
    </div>
  );
}

const NOT_HTML = "That isn’t an .html file. Upload a single HTML deliverable.";
const isHtml = (name: string) => /\.html?$/i.test(name);

function slugName(t: string): string {
  return (
    (t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 18) || "artefact") + ".html"
  );
}

// New upload, or (with `editing`) edit an artefact's title, kind and file.
// Mounted per open, so the form seeds once from `editing`.
export function UploadDialog({
  editing,
  busy,
  serverError,
  onClose,
  onSubmit,
}: {
  editing: ArtefactSummary | null;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (input: { title: string; kind: ArtefactKind; file: File | null }) => void;
}) {
  const isEdit = !!editing;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [kind, setKind] = useState<ArtefactKind>((editing?.kind as ArtefactKind) ?? "prototype");
  const [picked, setPicked] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Something occupies the file slot when a new file is picked, or (in edit
  // mode) the existing payload is shown as "current" until replaced.
  const hasFile = !!picked || isEdit;
  const fileName = picked ? picked.name : isEdit ? slugName(editing.title) : "";
  const fileMeta = picked
    ? `${fmtBytes(picked.size)} · HTML`
    : isEdit
      ? `${fmtBytes(editing.payloadBytes)} · current payload`
      : "";

  function setFile(f: File | null) {
    setPicked(f);
    setFileError(f && !isHtml(f.name) ? NOT_HTML : null);
  }

  function clearFile(e: React.MouseEvent) {
    e.stopPropagation();
    setPicked(null);
    setFileError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  }

  function submit() {
    const tErr = title.trim() ? null : "Give your artefact a title.";
    let fErr = fileError;
    if (!isEdit) {
      if (!picked) fErr = "Choose an .html file to upload.";
      else if (!isHtml(picked.name)) fErr = NOT_HTML;
    }
    setTitleError(tErr);
    setFileError(fErr);
    if (tErr || fErr) return;
    onSubmit({ title: title.trim(), kind, file: picked });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit artefact" : "New artefact"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the title, kind, or replace the HTML file." : "Upload a self-contained HTML deliverable."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div>
            <Label htmlFor="up-title" className="mb-2">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="up-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleError(null);
              }}
              placeholder="e.g. Pricing Page Redesign"
              aria-invalid={!!titleError}
            />
            {titleError && <FieldError>{titleError}</FieldError>}
          </div>

          <div>
            <Label className="mb-2">Kind</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => v && setKind(v as ArtefactKind)}
              className="flex w-full flex-wrap justify-start gap-1.5 shadow-none"
              spacing={1}
            >
              {KIND_ORDER.map((k) => {
                const m = KINDS[k];
                const Icon = m.icon;
                return (
                  <ToggleGroupItem
                    key={k}
                    value={k}
                    style={kindVars(k)}
                    className="h-8 flex-none px-2.5 data-[state=on]:border-(--kind) data-[state=on]:bg-(--kind-tint)"
                  >
                    <Icon className="text-muted-foreground in-data-[state=on]:text-(--kind)" />
                    {m.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>

          <div>
            <Label htmlFor="up-file" className="mb-2">
              HTML file {!isEdit && <span className="text-destructive">*</span>}
            </Label>
            <input
              id="up-file"
              ref={fileInput}
              type="file"
              accept=".html,.htm,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) setFile(f);
              }}
              className="hidden"
            />
            <div
              role="button"
              tabIndex={0}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
              className={cn(
                "flex min-h-24 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-dashed bg-muted/40 p-5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                fileError ? "border-destructive" : dragActive ? "border-primary bg-accent" : "border-input",
              )}
            >
              {hasFile ? (
                <div className="flex w-full items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent">
                    <FileText className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium">{fileName}</div>
                    <div className="text-xs text-muted-foreground">{fileMeta}</div>
                  </div>
                  {picked && (
                    <Button variant="ghost" size="icon" className="size-7" onClick={clearFile} aria-label="Remove file">
                      <X />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="pointer-events-none flex flex-col items-center gap-2">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Upload className="size-5" />
                  </div>
                  <div className="text-sm">
                    <span className="font-semibold">Click to upload</span>
                    <span className="text-muted-foreground"> or drag and drop</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    A single self-contained <span className="font-mono">.html</span> file
                  </div>
                </div>
              )}
            </div>
            {fileError && <FieldError>{fileError}</FieldError>}
          </div>

          {!isEdit && (
            <div className="flex items-center gap-2.5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <VIS.private.icon className="size-4 shrink-0" />
              <span>
                New artefacts start <strong className="font-semibold text-foreground">Private</strong> — you can share
                them or add them to a collection after uploading.
              </span>
            </div>
          )}

          {serverError && <FieldError>{serverError}</FieldError>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Working…" : isEdit ? "Save changes" : "Upload artefact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
