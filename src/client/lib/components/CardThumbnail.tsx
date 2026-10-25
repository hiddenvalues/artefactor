import { useState, type ReactNode } from "react";
import { thumbnailToShow } from "../artefact-card";
import { kindMeta } from "../format";
import { kindVars } from "../style";

// S35 — the preview area atop a grid card (dashboard, collection page, "Shared
// with you"). Shows the rendered thumbnail when there is one; with none, or when
// the image fails to load (e.g. access changed since the list was fetched), the
// striped kind placeholder. The card's chips stay overlaid; the kind is named by
// the title row's icon (S62), not on the thumbnail.
// S54 — the chips sit beside the open button, not inside it, so one of them can
// be a control of its own (the bookmark button).
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
  // The upper-right chips (saved-data icon, bookmark button).
  chips?: ReactNode;
}) {
  const Icon = kindMeta(kind).icon;
  // Remember the URL that failed, so a newer render (a new `?v=`) is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shown = thumbnailToShow(thumbnailUrl, failedUrl);

  return (
    <div className="relative">
      {/* eslint-disable-next-line no-restricted-syntax -- the whole thumbnail is the card's open target, a surface rather than a control */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${title}`}
        style={kindVars(kind)}
        className="relative flex aspect-[16/10] w-full cursor-pointer items-center justify-center overflow-hidden rounded-t-xl border-b bg-(--kind-tint) outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {shown !== null ? (
          <img
            src={shown}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailedUrl(shown)}
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--kind)_9px_10px)] opacity-50" />
            <Icon className="relative size-7 text-(--kind)" strokeWidth={1.7} />
          </>
        )}
      </button>
      {chips && <div className="absolute top-2 right-2 inline-flex gap-1">{chips}</div>}
    </div>
  );
}
