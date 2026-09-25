import { useState, type ReactNode } from "react";
import { Badge } from "$lib/components/ui/badge";
import { kindMeta } from "../format";
import { kindVars } from "../style";

// S35 — the preview area atop a grid card (dashboard, collection page, "Shared
// with you"). Shows the rendered thumbnail when there is one; with none, or when
// the image fails to load (e.g. access changed since the list was fetched), the
// striped kind placeholder. The kind badge and the card's chips stay overlaid.
export function CardThumbnail({
  kind,
  title,
  thumbnailUrl,
  onOpen,
  chips,
}: {
  kind: string;
  title: string;
  thumbnailUrl: string | null;
  onOpen: () => void;
  // The upper-right chips (bookmark / storage indicators).
  chips?: ReactNode;
}) {
  const m = kindMeta(kind);
  const Icon = m.icon;
  // Remember the URL that failed, so a newer render (a new `?v=`) is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = thumbnailUrl !== null && thumbnailUrl !== failedUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${title}`}
      style={kindVars(kind)}
      className="relative flex aspect-[16/10] w-full cursor-pointer items-center justify-center overflow-hidden rounded-t-xl border-b bg-(--kind-tint) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {showImage ? (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(thumbnailUrl)}
          className="absolute inset-0 size-full object-cover object-top"
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--kind)_9px_10px)] opacity-50" />
          <Icon className="relative size-7 text-(--kind)" strokeWidth={1.7} />
        </>
      )}
      <Badge variant="outline" className="absolute top-2 left-2 bg-card font-mono text-(--kind) shadow-sm">
        {m.label}
      </Badge>
      {chips && <span className="absolute top-2 right-2 inline-flex gap-1">{chips}</span>}
    </button>
  );
}
