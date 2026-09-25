import { Clock, Lock } from "lucide-react";
import type { LinkGateSummary } from "../../../shared/contracts";
import { isExpired } from "../link-protection";
import { useExpiryClock } from "../use-expiry-clock";
import { cn } from "../utils";

// S32a — the owner's lock / clock badges for a protected public link. A card
// shows them as chips over the thumbnail; a row inline in its meta line.
export function LinkGateBadges({
  gate,
  variant,
}: {
  gate: LinkGateSummary | null | undefined;
  variant: "chip" | "inline";
}) {
  const now = useExpiryClock(gate);
  const expired = isExpired(gate, now);
  const clockLabel = gate?.expiresAt
    ? expired
      ? "Link expired"
      : `Link expires ${new Date(gate.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : "";
  const box = variant === "chip" ? "rounded-md bg-card p-1 shadow-sm" : "";
  const size = variant === "chip" ? "size-3.5" : "size-3";

  return (
    <>
      {gate?.passwordProtected && (
        <span
          role="img"
          title="Password protected"
          aria-label="Password protected"
          className={cn("inline-flex items-center text-muted-foreground", box)}
        >
          <Lock className={size} />
        </span>
      )}
      {gate?.expiresAt && (
        <span
          role="img"
          title={clockLabel}
          aria-label={clockLabel}
          className={cn("inline-flex items-center", expired ? "text-destructive" : "text-muted-foreground", box)}
        >
          <Clock className={size} />
        </span>
      )}
    </>
  );
}
