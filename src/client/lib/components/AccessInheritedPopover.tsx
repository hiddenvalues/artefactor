import { useId, useState, type ReactNode } from "react";
import { Link as LinkIcon, Lock } from "lucide-react";
import type { LinkGateSummary } from "../../../shared/contracts";
import { Button } from "$lib/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "$lib/components/ui/popover";
import { Separator } from "$lib/components/ui/separator";
import { DATA_VIS, DATA_VIS_ORDER, type DataVisibility } from "../format";
import { describeGate, isExpired } from "../link-protection";
import { useExpiryClock } from "../use-expiry-clock";
import { cn } from "../utils";
import { ChoiceList } from "./ChoiceList";

const DATA_CHOICES = DATA_VIS_ORDER.map((v) => ({ value: v, ...DATA_VIS[v] }));

const SectionLabel = ({ children }: { children: string }) => (
  <div className="px-2 pt-1 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
    {children}
  </div>
);

// S41 (hosting.data-visibility.owner-set) — whether viewers may load each
// other's saved data: a divider, then the choices as a radiogroup named
// "Saved data". The tier picker shows the same section.
export function SavedData({ value, onChoose }: { value: DataVisibility; onChoose: (v: DataVisibility) => void }) {
  return (
    <>
      <Separator className="my-1" />
      <SectionLabel>Saved data</SectionLabel>
      <ChoiceList choices={DATA_CHOICES} value={value} onChoose={onChoose} aria-label="Saved data" />
    </>
  );
}

// S32b — the tree root's link protection, read-only, red once expired. Its own
// component so the expiry clock only runs while the popover is open.
function InheritedGate({ rootName, gate }: { rootName: string; gate: LinkGateSummary }) {
  const now = useExpiryClock(gate);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border p-2">
      <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-xs font-medium">Link protection inherited from “{rootName}”</span>
        <span className={cn("block text-xs", isExpired(gate, now) ? "text-destructive" : "text-muted-foreground")}>
          {describeGate(gate, now)}
        </span>
      </span>
    </div>
  );
}

// S64 — the "Access inherited" popover: what an owner sees behind Share on a
// card or row inside a collection (288px, `share`), and behind a nested
// collection header's access pill (256px, `pill`). Read-only, since the tree
// root governs (hosting.access.effective-from-tree-root). Top to bottom: the
// share link, when the caller passes one · the explanation · the inherited link
// protection (S32b) · Open "<collection>" · Saved data (S41).
export function AccessInheritedPopover({
  trigger,
  width,
  collectionName,
  gate,
  onOpenCollection,
  link = null,
  usesStorage = false,
  dataVisibility,
  onChooseData,
  inline = false,
}: {
  // The button the popover opens from, wrapped with `PopoverTrigger asChild`.
  trigger: ReactNode;
  width: "share" | "pill";
  collectionName: string;
  // S32b — the tree root's link protection, shown read-only.
  gate: { rootName: string; gate: LinkGateSummary } | null;
  onOpenCollection?: () => void;
  // The artefact's share link, under hosting.card.share-link-unless-private;
  // copying it leaves the popover open. A collection has none.
  link?: { path: string; onCopy: () => void } | null;
  usesStorage?: boolean;
  dataVisibility?: DataVisibility;
  onChooseData?: (v: DataVisibility) => void;
  // Catalog-only: the content drawn open, in flow below the trigger, on the
  // popover's own surface, so a design-sync card can show every state open
  // (a portalled popover escapes its cell).
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  function chooseData(v: DataVisibility) {
    setOpen(false);
    if (v !== dataVisibility) onChooseData?.(v);
  }

  const frame = cn("p-1", width === "share" ? "w-72" : "w-64");
  const body = (
    <>
      {link && (
        <>
          <SectionLabel>Link</SectionLabel>
          <div className="px-2 pb-1.5">
            <Button
              type="button"
              variant="link"
              onClick={link.onCopy}
              aria-label={`Copy link ${link.path}`}
              title={`Copy ${location.origin}${link.path}`}
              className="h-auto gap-1.5 p-0 font-mono text-sm text-primary has-[>svg]:px-0"
            >
              <LinkIcon className="size-3.5" />
              {link.path}
            </Button>
          </div>
          <Separator className="my-1" />
        </>
      )}
      <div className="p-2">
        <div id={titleId} className="text-sm font-semibold">
          Access inherited
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          This artefact is in “{collectionName}” and follows its access. Change it on the collection.
        </p>
        {gate && <InheritedGate rootName={gate.rootName} gate={gate.gate} />}
        {onOpenCollection && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setOpen(false);
              onOpenCollection();
            }}
          >
            Open “{collectionName}”
          </Button>
        )}
      </div>
      {usesStorage && dataVisibility !== undefined && onChooseData && (
        <SavedData value={dataVisibility} onChoose={chooseData} />
      )}
    </>
  );

  if (inline)
    return (
      <div className="flex flex-col items-end gap-1">
        {trigger}
        <div
          role="dialog"
          aria-labelledby={titleId}
          className={cn("rounded-md border bg-popover text-popover-foreground shadow-md", frame)}
        >
          {body}
        </div>
      </div>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className={frame}>
        {body}
      </PopoverContent>
    </Popover>
  );
}
