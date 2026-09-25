import { useState } from "react";
import { ChevronDown, ChevronRight, Lock, Users } from "lucide-react";
import type { LinkGateSummary, SetLinkGateRequest } from "../../../shared/contracts";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "$lib/components/ui/popover";
import { Separator } from "$lib/components/ui/separator";
import { DATA_VIS, DATA_VIS_ORDER, VIS, VIS_ORDER, type DataVisibility, type Visibility } from "../format";
import { gateChange, isExpired, linkGateOnPublish, type LinkProtectionForm } from "../link-protection";
import { useExpiryClock } from "../use-expiry-clock";
import { cn } from "../utils";
import { ChoiceList } from "./ChoiceList";
import { LinkProtection } from "./LinkProtection";

const TIERS = VIS_ORDER.map((v) => ({ value: v, ...VIS[v] }));
const DATA_CHOICES = DATA_VIS_ORDER.map((v) => ({ value: v, ...DATA_VIS[v] }));

const SectionLabel = ({ children }: { children: string }) => (
  <div className="px-2 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
    {children}
  </div>
);

// The tier picker on a card, a row and a collection header.
export function VisibilityControl({
  visibility,
  variant = "block",
  onChoose,
  onManage,
  inherited = false,
  inheritedFrom = "",
  onOpenCollection,
  note = "",
  usesStorage = false,
  dataVisibility,
  onChooseData,
  linkProtection,
}: {
  visibility: Visibility;
  variant?: "block" | "pill";
  onChoose: (v: Visibility) => void;
  // S16 — opens the "Manage access" panel; shown only while `selected`.
  onManage?: () => void;
  // S25 (AH20) — the access is inherited from a collection: the control is
  // read-only; `visibility` is the effective tier; the popover explains and
  // links to the collection instead of offering the tiers.
  inherited?: boolean;
  inheritedFrom?: string;
  onOpenCollection?: () => void;
  // S25 — an explanatory line atop the tiers (the collection header uses it to
  // say everything inside inherits the choice).
  note?: string;
  // S41 (AH30) — the "Saved data" section: whether viewers may load each
  // other's saved data. Shown only for an artefact that persists data, and also
  // while access is inherited, since the setting is per artefact.
  usesStorage?: boolean;
  dataVisibility?: DataVisibility;
  onChooseData?: (v: DataVisibility) => void;
  // S32a (AH31) — link protection on a public artefact. When given, choosing
  // Public first reveals the "Link protection" section (submitted with the tier
  // change), and while public the section edits the gate. Never while
  // inherited: a contained artefact's own tier and gate are dormant.
  linkProtection?: {
    current: LinkGateSummary | null;
    onPublish: (gate: { password?: string; expiresAt?: string } | undefined) => void;
    onSave: (change: SetLinkGateRequest) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  // S32a — "publish": Public was chosen and waits for its link protection;
  // "edit": editing the gate of a public artefact. Reset whenever it closes.
  const [gateMode, setGateMode] = useState<"publish" | "edit" | null>(null);
  const gateOffered = !!linkProtection && !inherited;
  const gate = linkProtection?.current ?? null;
  const now = useExpiryClock(gate);
  const gateExpired = isExpired(gate, now);
  const meta = VIS[visibility];
  const Icon = meta.icon;
  const showSavedData = usesStorage && dataVisibility !== undefined && !!onChooseData;
  // S16 — when shared with specific people, offer a way back into the picker.
  // Never while inherited: the people list belongs to the collection then.
  const showManage = visibility === "selected" && !!onManage && !inherited;

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

  function gateSummary(g: LinkGateSummary | null): string {
    if (!g) return "Anyone with the link can open it";
    const parts: string[] = [];
    if (g.passwordProtected) parts.push("Password");
    if (g.expiresAt)
      parts.push(
        gateExpired
          ? "Link expired"
          : `Expires ${new Date(g.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`,
      );
    return parts.join(" · ");
  }

  const savedData = showSavedData && (
    <>
      <Separator className="my-1" />
      <SectionLabel>Saved data</SectionLabel>
      <ChoiceList choices={DATA_CHOICES} value={dataVisibility} onChoose={chooseData} />
    </>
  );

  const manage = showManage && (
    <Button variant="outline" size="sm" onClick={onManage} title="Manage who has access" className={cn(variant === "block" && "w-full")}>
      <Users />
      {variant === "block" ? "Manage access" : "Manage"}
    </Button>
  );

  return (
    <div className={variant === "block" ? "flex flex-col gap-1.5" : "inline-flex shrink-0 items-center gap-1.5"}>
      {variant === "pill" && manage}
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("bg-muted/40 font-medium", variant === "block" && "w-full justify-start")}>
            <Icon />
            {meta.label}
            {inherited ? (
              <Badge variant="secondary" className={cn("uppercase", variant === "block" && "ml-auto")}>
                Inherited
              </Badge>
            ) : (
              <ChevronDown className={cn("text-muted-foreground", variant === "block" && "ml-auto")} />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align={variant === "block" ? "start" : "end"}
          className={cn("p-1", variant === "block" ? "w-(--radix-popover-trigger-width) min-w-64" : "w-64")}
        >
          {inherited ? (
            <>
              <div className="p-2">
                <div className="text-sm font-semibold">Access inherited</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This artefact is in “{inheritedFrom}” and follows its access. Change it on the collection.
                </p>
                {onOpenCollection && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => {
                      setOpenState(false);
                      onOpenCollection();
                    }}
                  >
                    Open “{inheritedFrom}”
                  </Button>
                )}
              </div>
              {savedData}
            </>
          ) : gateMode !== null ? (
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
                        {gateSummary(gate)}
                      </span>
                    </span>
                    <ChevronRight className="text-muted-foreground" />
                  </Button>
                </>
              )}
              {savedData}
            </>
          )}
        </PopoverContent>
      </Popover>
      {variant === "block" && manage}
    </div>
  );
}
