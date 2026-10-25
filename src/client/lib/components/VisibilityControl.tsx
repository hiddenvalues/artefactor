import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Lock, Users } from "lucide-react";
import type { LinkGateSummary, SetLinkGateRequest } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "$lib/components/ui/popover";
import { Separator } from "$lib/components/ui/separator";
import { VIS, VIS_ORDER, type DataVisibility, type Visibility } from "../format";
import { copyText, describeGate, gateChange, isExpired, linkGateOnPublish, type LinkProtectionForm } from "../link-protection";
import { useExpiryClock } from "../use-expiry-clock";
import { cn } from "../utils";
import { AccessInheritedPopover, SavedData } from "./AccessInheritedPopover";
import { ChoiceList } from "./ChoiceList";
import { LinkProtection } from "./LinkProtection";

const TIERS = VIS_ORDER.map((v) => ({ value: v, ...VIS[v] }));

// S44 — a public root's id, read-only, with a Copy button: what a site built
// without a login is configured with to read the tree.
function PublicCollectionId({ id }: { id: string }) {
  const [copyLabel, setCopyLabel] = useState<"Copy" | "Copied" | "Copy failed">("Copy");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function copy() {
    setCopyLabel(await copyText(navigator.clipboard, id));
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyLabel("Copy"), 1600);
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <span className="text-sm font-medium">Public collection id</span>
      <div className="flex gap-1.5">
        <Input
          value={id}
          readOnly
          aria-label="Public collection id"
          spellCheck={false}
          className="h-8 font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button variant="outline" size="sm" onClick={copy} title="Copy the public collection id">
          <Copy />
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}

// The tier picker on a collection header. On a nested collection the access is
// inherited, and the pill opens the "Access inherited" popover (S64) instead.
export function VisibilityControl({
  visibility,
  onChoose,
  onManage,
  inherited = false,
  inheritedFrom = "",
  inheritedGate = null,
  onOpenCollection,
  note = "",
  usesStorage = false,
  dataVisibility,
  onChooseData,
  linkProtection,
  publicCollectionId = null,
}: {
  visibility: Visibility;
  onChoose: (v: Visibility) => void;
  // S16 — opens the "Manage access" panel; shown only while `selected`.
  onManage?: () => void;
  // S25 (hosting.access.effective-from-tree-root) — the access is inherited from a collection: the
  // control is read-only; `visibility` is the effective tier; the popover explains and links to the
  // collection instead of offering the tiers.
  inherited?: boolean;
  inheritedFrom?: string;
  // S32b — the tree root's link protection, shown read-only while inherited.
  inheritedGate?: { rootName: string; gate: LinkGateSummary } | null;
  onOpenCollection?: () => void;
  // S25 — an explanatory line atop the tiers (the collection header uses it to
  // say everything inside inherits the choice).
  note?: string;
  // S41 (hosting.data-visibility.owner-set) — the "Saved data" section: whether viewers may load
  // each other's saved data. Shown only for an artefact that persists data, and also while access
  // is inherited, since the setting is per artefact.
  usesStorage?: boolean;
  dataVisibility?: DataVisibility;
  onChooseData?: (v: DataVisibility) => void;
  // S32a (hosting.link-gate.public-only) — link protection on a public artefact. When given,
  // choosing Public first reveals the "Link protection" section (submitted with the tier change),
  // and while public the section edits the gate. Never while inherited: a contained artefact's own
  // tier and gate are dormant.
  linkProtection?: {
    current: LinkGateSummary | null;
    onPublish: (gate: { password?: string; expiresAt?: string } | undefined) => void;
    onSave: (change: SetLinkGateRequest) => void;
  };
  // S44 — a public root's id, shown read-only with a Copy button while the
  // tier is public. Only a collection header passes it.
  publicCollectionId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // S32a — "publish": Public was chosen and waits for its link protection;
  // "edit": editing the gate of a public artefact. Reset whenever it closes.
  const [gateMode, setGateMode] = useState<"publish" | "edit" | null>(null);
  const gateOffered = !!linkProtection;
  const gate = linkProtection?.current ?? null;
  const now = useExpiryClock(gate);
  const gateExpired = isExpired(gate, now);
  const meta = VIS[visibility];
  const Icon = meta.icon;
  // S16 — when shared with specific people, offer a way back into the picker.
  // Inherited access returns the popover below instead: the people list
  // belongs to the collection then, and the gate is the tree root's.
  const showManage = visibility === "selected" && !!onManage;

  if (inherited)
    return (
      <AccessInheritedPopover
        width="pill"
        trigger={
          <Button variant="outline" size="sm" className="bg-muted/40 font-medium">
            <Icon />
            {meta.label}
            <Badge variant="secondary" className="uppercase">
              Inherited
            </Badge>
          </Button>
        }
        collectionName={inheritedFrom}
        gate={inheritedGate}
        onOpenCollection={onOpenCollection}
        usesStorage={usesStorage}
        dataVisibility={dataVisibility}
        onChooseData={onChooseData}
      />
    );

  function setOpenState(next: boolean) {
    setOpen(next);
    if (!next) setGateMode(null);
  }

  function choose(v: Visibility) {
    // S32a — Public reveals the link protection first, submitted with the tier.
    if (v === "public" && v !== visibility && gateOffered) {
      setGateMode("publish");
      return;
    }
    setOpenState(false);
    if (v !== visibility) onChoose(v);
  }

  function chooseData(v: DataVisibility) {
    setOpenState(false);
    if (v !== dataVisibility) onChooseData?.(v);
  }

  function submitGate(form: LinkProtectionForm) {
    const at = new Date();
    const mode = gateMode;
    setOpenState(false);
    if (mode === "publish") linkProtection?.onPublish(linkGateOnPublish(form, at));
    else linkProtection?.onSave(gateChange(form, gate, at));
  }

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      {showManage && (
        <Button variant="outline" size="sm" onClick={onManage} title="Manage who has access">
          <Users />
          Manage
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="bg-muted/40 font-medium">
            <Icon />
            {meta.label}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          {gateMode !== null ? (
            <LinkProtection
              mode={gateMode}
              current={gate}
              submitLabel={gateMode === "publish" ? "Make public" : "Save"}
              onSubmit={submitGate}
              onCancel={() => setGateMode(null)}
            />
          ) : (
            <>
              {note && <p className="mb-1 border-b p-2 text-xs leading-relaxed text-muted-foreground">{note}</p>}
              <ChoiceList choices={TIERS} value={visibility} onChoose={choose} />
              {gateOffered && visibility === "public" && (
                <>
                  <Separator className="my-1" />
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2.5 p-2 text-left font-normal"
                    onClick={() => setGateMode("edit")}
                  >
                    <Lock className="size-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Link protection</span>
                      <span className={cn("block text-xs", gateExpired ? "text-destructive" : "text-muted-foreground")}>
                        {describeGate(gate, now)}
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground" />
                  </Button>
                </>
              )}
              {publicCollectionId && visibility === "public" && (
                <>
                  <Separator className="my-1" />
                  <PublicCollectionId id={publicCollectionId} />
                </>
              )}
              {usesStorage && dataVisibility !== undefined && onChooseData && (
                <SavedData value={dataVisibility} onChoose={chooseData} />
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
