import { Bookmark, Database } from "lucide-react";
import { definePreview } from "../../design/preview";
import { noop, thumbnail } from "../../design/fixtures";
import { KIND_ORDER, kindMeta } from "../format";
import { chip } from "./ArtefactCard";
import { CardThumbnail } from "./CardThumbnail";

export default definePreview({
  title: "Card thumbnail",
  variants: [
    {
      name: "Kind placeholders (no render yet)",
      render: () =>
        KIND_ORDER.map((k) => (
          <div key={k} className="w-56">
            <CardThumbnail kind={k} title={kindMeta(k).label} thumbnailUrl={null} onOpen={noop} />
          </div>
        )),
    },
    {
      name: "Rendered thumbnail, with chips",
      render: () => (
        <div className="w-56">
          <CardThumbnail
            kind="prototype"
            title="Onboarding flow"
            thumbnailUrl={thumbnail}
            onOpen={noop}
            chips={
              <>
                <span className={chip}>
                  <Bookmark className="size-3.5 fill-current" />
                </span>
                <span className={chip}>
                  <Database className="size-3.5" />
                </span>
              </>
            }
          />
        </div>
      ),
    },
  ],
});
