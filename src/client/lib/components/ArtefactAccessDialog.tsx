import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RemoveScroll } from "react-remove-scroll";
import { Check, CircleAlert, Database, Link as LinkIcon, Lock, Plus, Users, X } from "lucide-react";
import type { ArtefactSummary, UserRef } from "../../../shared/contracts";
import { shareLinkPath } from "../../../shared/share-link";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
import { Button } from "$lib/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "$lib/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "$lib/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "$lib/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "$lib/components/ui/select";
import { Separator } from "$lib/components/ui/separator";
import {
  chooseLevel,
  draftGateOf,
  draftOf,
  protectionError,
  saveToastOf,
  sectionsOf,
  sharingRequestOf,
  withLoadedMembers,
  type AccessDraft,
} from "../access-dialog";
import { api } from "../api";
import { DATA_VIS, DATA_VIS_ORDER, initials, VIS, VIS_ORDER, type Visibility } from "../format";
import { copyText } from "../link-protection";
import { notify } from "../toast";
import { ChoiceList } from "./ChoiceList";
import { LinkGateBadges } from "./LinkGateBadges";
import { LinkProtection } from "./LinkProtection";
import { FieldError } from "./UploadDialog";

const DATA_CHOICES = DATA_VIS_ORDER.map((v) => ({ value: v, ...DATA_VIS[v] }));

/** The catalog's states: a preview opens the dialog part-way through an edit. */
export interface AccessDialogInitial {
  // The saved access list, instead of loading it (null = still loading).
  members?: UserRef[] | null;
  draft?: (saved: AccessDraft) => AccessDraft;
  query?: string;
  levelsOpen?: boolean;
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>
);

function Person({ u, action }: { u: UserRef; action?: ReactNode }) {
  return (
    <>
      <Avatar className="size-8">
        <AvatarFallback className="text-xs font-semibold">{initials(u.name || u.email)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
        <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
      </span>
      {action}
    </>
  );
}

// The General settings trigger and its listbox of the four levels, on the stock
// Select: a listbox of `option`s with `aria-selected` and a check on the
// current one, arrow keys, and Esc closing the list before the dialog.
function LevelPicker({
  draft,
  onChoose,
  initiallyOpen = false,
}: {
  draft: AccessDraft;
  onChoose: (level: Visibility) => void;
  initiallyOpen?: boolean;
}) {
  const meta = VIS[draft.level];
  const Icon = meta.icon;
  const now = new Date();

  return (
    <Select defaultOpen={initiallyOpen} value={draft.level} onValueChange={(v) => onChoose(v as Visibility)}>
      <SelectTrigger
        aria-haspopup="listbox"
        aria-label={`Access level: ${meta.label}`}
        className="h-auto w-full gap-3 rounded-lg p-2.5 text-left whitespace-normal data-[size=default]:h-auto"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icon className="size-4 text-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {meta.label}
            <LinkGateBadges gate={draftGateOf(draft, now)} />
          </span>
          <span className="block text-xs text-muted-foreground">{meta.desc}</span>
        </span>
      </SelectTrigger>
      <SelectContent position="popper" aria-label="Access level">
        {VIS_ORDER.map((level) => {
          const m = VIS[level];
          const LevelIcon = m.icon;
          return (
            <SelectItem key={level} value={level} className="items-start p-2 pr-8">
              <LevelIcon className="mt-0.5" />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 font-medium">
                  {m.label}
                  {level === "public" && <LinkGateBadges gate={draftGateOf({ ...draft, level }, now)} />}
                </span>
                <span className="text-xs text-muted-foreground">{m.desc}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

// The Viewers section: the directory search and the draft's people.
function Viewers({
  members,
  loading,
  loadFailed = false,
  onAdd,
  onRemove,
  initialQuery = "",
  searchOpen,
}: {
  members: UserRef[];
  loading: boolean;
  loadFailed?: boolean;
  onAdd: (u: UserRef) => void;
  onRemove: (u: UserRef) => void;
  initialQuery?: string;
  /** Mirrors whether the results popover is open, for the dialog's outside-click handler. */
  searchOpen?: { current: boolean };
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(Boolean(initialQuery.trim()));
  const [highlighted, setHighlighted] = useState("");
  const [results, setResults] = useState<UserRef[]>([]);
  const [searching, setSearching] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = results.filter((u) => !memberIds.has(u.id));

  // Debounced directory search as the owner types.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    // A response for a query the owner has since changed is dropped, so Enter never
    // adds a person from an older search.
    let current = true;
    const t = setTimeout(async () => {
      let found: UserRef[] = [];
      try {
        found = await api.searchUsers(q);
      } catch {
        // Treated as no matches.
      }
      if (!current) return;
      setResults(found);
      setSearching(false);
    }, 220);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [query]);

  // cmdk 1.1 always marks its input expanded, and misses the highlighted option
  // when it picks the first one itself: the field states both from our state.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute("aria-expanded", String(open));
    const list = open && highlighted ? document.getElementById(input.getAttribute("aria-controls") ?? "") : null;
    const active = list?.querySelector(`[cmdk-item][data-value="${CSS.escape(highlighted)}"]`)?.id;
    if (active) input.setAttribute("aria-activedescendant", active);
    else input.removeAttribute("aria-activedescendant");
  });

  // Updated after the commit, so a click outside both layers still finds it open.
  useEffect(() => {
    if (!searchOpen) return;
    searchOpen.current = open;
    return () => {
      searchOpen.current = false;
    };
  }, [open, searchOpen]);

  function search(q: string) {
    setQuery(q);
    setOpen(Boolean(q.trim()));
  }

  // Dismissed with a query still in the field, ↓, ↑ or a click brings the results back.
  function reopen() {
    if (!open && query.trim()) setOpen(true);
  }

  // r[impl hosting.access-dialog.search-keyboard+2]
  function add(u: UserRef) {
    onAdd(u);
    search("");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* r[impl hosting.access-dialog.search-popover] */}
      <Popover open={open} onOpenChange={setOpen}>
        <Command
          shouldFilter={false}
          label="Search people"
          value={highlighted}
          onValueChange={setHighlighted}
          vimBindings={false}
          className="overflow-visible bg-transparent"
        >
          <PopoverAnchor asChild>
            <div
              ref={anchorRef}
              className="rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30 [&_[data-slot=command-input-wrapper]]:border-b-0"
            >
              <CommandInput
                ref={inputRef}
                value={query}
                onValueChange={search}
                placeholder="Search people by name or email…"
                aria-label="Search people"
                className="text-base md:text-sm"
                // Home and End move the caret in the field, not the highlight.
                onKeyDown={(e) => {
                  if (e.key === "Home" || e.key === "End") e.stopPropagation();
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") reopen();
                }}
                onClick={reopen}
                // Opened mid-search (a catalog state), the field holds focus, so the
                // dialog's auto-focus doesn't land outside the popover and close it.
                autoFocus={open}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            role="presentation"
            className="w-(--radix-popover-trigger-width) p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            // A press on the list, its scrollbar or the status keeps focus in the field.
            onMouseDown={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
            }}
          >
            {/* The dialog's scroll lock cancels wheel and touch outside it, and the
                results are portalled out of it: this lock, on top, lets the list scroll. */}
            <RemoveScroll allowPinchZoom>
              <CommandList className="max-h-55">
                <CommandEmpty>
                  <span role="status">{searching ? "Searching…" : "No people found."}</span>
                </CommandEmpty>
                {!searching &&
                  candidates.map((u) => (
                    <CommandItem key={u.id} value={u.id} onSelect={() => add(u)} className="gap-2.5 p-1.5">
                      <Person u={u} action={<Plus className="size-4 shrink-0" />} />
                    </CommandItem>
                  ))}
              </CommandList>
            </RemoveScroll>
          </PopoverContent>
        </Command>
      </Popover>
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          People with access{!loading && !loadFailed && members.length ? ` · ${members.length}` : ""}
        </div>
        {loading ? (
          <div className="py-3 text-sm text-muted-foreground">Loading…</div>
        ) : loadFailed ? (
          <FieldError>Couldn't load who has access.</FieldError>
        ) : members.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No one yet — search above to add people. Until then, only you can open it.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {members.map((u) => (
              <div key={u.id} className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-1.5">
                <Person
                  u={u}
                  action={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      onClick={() => onRemove(u)}
                      title="Remove access"
                      aria-label={`Remove ${u.name || u.email}`}
                    >
                      <X />
                    </Button>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// S55 — Manage access dialog: one draft, saved atomically. Every sharing setting
// of a top-level artefact, kept as a draft and sent as one request on Done
// (`docs/design/components/manage-access-dialog.md`). `onSaved` refreshes the
// library after a save or an Undo.
export function ArtefactAccessDialog({
  artefact,
  onClose,
  onSaved,
  initial,
}: {
  artefact: ArtefactSummary;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  initial?: AccessDialogInitial;
}) {
  const [savedMembers, setSavedMembers] = useState<UserRef[] | null>(
    initial?.members !== undefined ? initial.members : null,
  );
  const saved = useMemo(() => draftOf(artefact, savedMembers ?? []), [artefact, savedMembers]);
  const [draft, setDraft] = useState<AccessDraft>(() => (initial?.draft ? initial.draft(saved) : saved));
  const [busy, setBusy] = useState(false);
  // A list that failed to load is unknown, not empty: Done stays off, since a save could
  // otherwise replace the real list with a partial one (hosting.sharing.members-replace).
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = savedMembers === null && !loadFailed;

  // The saved access list loads once on open; the draft takes it, keeping any
  // edit made meanwhile.
  useEffect(() => {
    if (initial?.members !== undefined) return;
    let cancelled = false;
    api
      .getAccess(artefact.id)
      .then((m) => {
        if (cancelled) return;
        setSavedMembers(m);
        setDraft((d) => withLoadedMembers(d, m));
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        notify(`Couldn't load who has access to “${artefact.title}”.`, CircleAlert);
      });
    return () => {
      cancelled = true;
    };
  }, [artefact.id, artefact.title, initial?.members]);

  const now = new Date();
  const sections = sectionsOf(draft, artefact.usesStorage);
  const error = protectionError(draft, now);
  const linkPath = artefact.publicSlug ? shareLinkPath(artefact.publicSlug) : null;
  const title = artefact.title;

  async function copyLink() {
    if (!linkPath) return;
    const result = await copyText(navigator.clipboard, location.origin + linkPath);
    notify(result === "Copied" ? "Link copied" : "Couldn't copy the link", result === "Copied" ? Check : CircleAlert);
  }

  async function undo(request: NonNullable<ReturnType<typeof saveToastOf>["undo"]>) {
    try {
      await api.setSharing(artefact.id, request);
      await onSaved();
      notify(`Access for “${title}” restored`, Check);
    } catch {
      notify("Couldn't undo. Try again.", CircleAlert);
    }
  }

  // While a save is in flight the buttons ignore clicks rather than disabling:
  // a disabled Done would drop focus out of the dialog, and with it Esc.
  async function done() {
    if (busy) return;
    const request = sharingRequestOf(saved, draft, new Date());
    if (request === null) return onClose();
    const toast = saveToastOf(saved, draft, title);
    setBusy(true);
    try {
      await api.setSharing(artefact.id, request);
    } catch {
      setBusy(false);
      notify(
        draft.level !== saved.level && draft.level === "public"
          ? `Couldn't make “${title}” public. Try again.`
          : `Couldn't save access for “${title}”. Try again.`,
        CircleAlert,
      );
      return;
    }
    onClose();
    await onSaved();
    const icon =
      draft.level !== saved.level ? VIS[draft.level].icon : request.members ? Users : request.linkGate ? Lock : Database;
    const undoRequest = toast.undo;
    notify(toast.message, icon, undoRequest ? { label: "Undo", onClick: () => void undo(undoRequest) } : undefined);
  }

  const divider = <Separator className="my-1" />;
  const searchOpen = useRef(false);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-[460px]"
        // A click outside with the viewer results open closes only the results, as Esc does.
        onPointerDownOutside={(e) => {
          if (searchOpen.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription className="truncate">Who can open “{title}”</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex flex-col gap-4 overflow-y-auto px-1">
          <section>
            <SectionLabel>General settings</SectionLabel>
            <LevelPicker
              draft={draft}
              initiallyOpen={initial?.levelsOpen}
              onChoose={(level) => setDraft(chooseLevel(draft, saved, level))}
            />
          </section>

          {sections.link && (
            <>
              {divider}
              <section>
                <SectionLabel>Link</SectionLabel>
                {linkPath ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => void copyLink()}
                    aria-label={`Copy link ${linkPath}`}
                    title={`Copy ${location.origin}${linkPath}`}
                    className="h-auto gap-1.5 p-0 font-mono text-sm text-primary has-[>svg]:px-0"
                  >
                    <LinkIcon className="size-3.5" />
                    {linkPath}
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">The link is created when you click Done.</p>
                )}
              </section>
            </>
          )}

          {sections.viewers && (
            <>
              {divider}
              <section>
                <SectionLabel>Viewers</SectionLabel>
                <Viewers
                  members={draft.members}
                  loading={loading}
                  loadFailed={loadFailed}
                  initialQuery={initial?.query}
                  searchOpen={searchOpen}
                  onAdd={(u) => setDraft({ ...draft, members: [...draft.members, u] })}
                  onRemove={(u) => setDraft({ ...draft, members: draft.members.filter((m) => m.id !== u.id) })}
                />
              </section>
            </>
          )}

          {sections.protection && (
            <>
              {divider}
              <section className="-m-2">
                <LinkProtection
                  current={draft.gate.current}
                  form={draft.gate.form}
                  error={error}
                  onChange={(form) => setDraft({ ...draft, gate: { ...draft.gate, form } })}
                />
              </section>
            </>
          )}

          {sections.savedData && (
            <>
              {divider}
              <section>
                <SectionLabel>Saved data</SectionLabel>
                <ChoiceList
                  choices={DATA_CHOICES}
                  value={draft.dataVisibility}
                  onChoose={(dataVisibility) => setDraft({ ...draft, dataVisibility })}
                  className="-mx-2"
                />
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => !busy && onClose()} aria-busy={busy || undefined}>
            Cancel
          </Button>
          <Button onClick={() => void done()} disabled={loading || loadFailed || error !== null} aria-busy={busy || undefined}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
