import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { UserRef } from "../../../shared/contracts";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar";
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
import { api, ApiError } from "../api";
import { initials } from "../format";
import { FieldError } from "./UploadDialog";

export interface AccessTarget {
  kind: "artefact" | "collection";
  id: string;
  title: string;
}

function Person({ u, action }: { u: UserRef; action?: React.ReactNode }) {
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

// S16/S25 — the same member picker manages an artefact's `selected`-tier list
// and a collection root's (whose people the whole tree inherits, CL4).
export function ManageAccessDialog({ target, onClose }: { target: AccessTarget; onClose: () => void }) {
  const calls = useMemo(
    () =>
      target.kind === "artefact"
        ? {
            get: () => api.getAccess(target.id),
            grant: (userId: string) => api.grantAccess(target.id, userId),
            revoke: (userId: string) => api.revokeAccess(target.id, userId),
          }
        : {
            get: () => api.getCollectionAccess(target.id),
            grant: (userId: string) => api.grantCollectionAccess(target.id, userId),
            revoke: (userId: string) => api.revokeCollectionAccess(target.id, userId),
          },
    [target.kind, target.id],
  );

  const [members, setMembers] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserRef[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hide people already on the list from the search results.
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = results.filter((u) => !memberIds.has(u.id));

  // Load the current members once when the dialog opens.
  useEffect(() => {
    let cancelled = false;
    calls
      .get()
      .then((m) => !cancelled && setMembers(m))
      .catch(() => !cancelled && setError("Could not load the current list."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [calls]);

  // Debounced directory search as the owner types.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await api.searchUsers(q));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  async function add(u: UserRef) {
    setBusyId(u.id);
    setError(null);
    try {
      await calls.grant(u.id);
      setMembers((m) => [...m, u]);
      setQuery("");
      setResults([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that person.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(u: UserRef) {
    setBusyId(u.id);
    setError(null);
    try {
      await calls.revoke(u.id);
      setMembers((m) => m.filter((x) => x.id !== u.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove that person.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage access</DialogTitle>
          <DialogDescription className="truncate">
            {target.kind === "collection"
              ? `Who can open “${target.title}” — everything inside inherits this list`
              : `Who can open “${target.title}”`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people by name or email…"
              autoComplete="off"
              className="pl-9"
            />
            {query.trim() && (
              <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border p-1 shadow-md">
                {searching ? (
                  <div className="p-2 text-sm text-muted-foreground">Searching…</div>
                ) : candidates.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">No people found.</div>
                ) : (
                  candidates.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => add(u)}
                      disabled={busyId === u.id}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm p-1.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Person u={u} action={<Plus className="size-4 shrink-0" />} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {error && <FieldError>{error}</FieldError>}

          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              People with access{members.length ? ` · ${members.length}` : ""}
            </div>
            {loading ? (
              <div className="py-3 text-sm text-muted-foreground">Loading…</div>
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
                          onClick={() => remove(u)}
                          disabled={busyId === u.id}
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

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
