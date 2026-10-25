import { Clock, Lock } from "lucide-react";
import type { LinkGateSummary } from "../../../shared/contracts";
import { isExpired } from "../link-protection";
import { useExpiryClock } from "../use-expiry-clock";
import { cn } from "../utils";

// S32a — the owner's lock / clock icons for a protected public link: inside a
// card's or row's access badge (S54, S56) and inline in a collection header.
export function LinkGateBadges({ gate }: { gate: LinkGateSummary | null | undefined }) {
  const now = useExpiryClock(gate);
  const expired = isExpired(gate, now);
  const clockLabel = gate?.expiresAt
    ? expired
      ? "Link expired"
      : `Link expires ${new Date(gate.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : "";

  return (
    <>
      {gate?.passwordProtected && (
        <span role="img" title="Password protected" aria-label="Password protected" className="inline-flex items-center text-muted-foreground">
          <Lock className="size-3" />
        </span>
      )}
      {gate?.expiresAt && (
        <span
          role="img"
          title={clockLabel}
          aria-label={clockLabel}
          className={cn("inline-flex items-center", expired ? "text-destructive" : "text-muted-foreground")}
        >
          <Clock className="size-3" />
        </span>
      )}
    </>
  );
}
