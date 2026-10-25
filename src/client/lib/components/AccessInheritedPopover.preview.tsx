import { useState } from "react";
import { Share2 } from "lucide-react";
import { definePreview } from "../../design/preview";
import { gates, noop } from "../../design/fixtures";
import type { LinkGateSummary } from "../../../shared/contracts";
import type { DataVisibility } from "../format";
import { VIS } from "../format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { AccessInheritedPopover } from "./AccessInheritedPopover";

const LINK = { path: "/a/k3Rq9XwT2pL", onCopy: noop };

const ShareButton = () => (
  <Button variant="outline" size="sm" aria-haspopup="dialog">
    <Share2 />
    Share
  </Button>
);

function PillButton() {
  const Icon = VIS.authenticated.icon;
  return (
    <Button variant="outline" size="sm" className="bg-muted/40 font-medium">
      <Icon />
      {VIS.authenticated.label}
      <Badge variant="secondary" className="uppercase">
        Inherited
      </Badge>
    </Button>
  );
}

// Drawn open, in flow below its trigger, on the overview, the standalone page and
// in each design-sync cell alike.
function Example({
  from = "share",
  link = LINK,
  gate = null,
  usesStorage = false,
}: {
  from?: "share" | "pill";
  link?: typeof LINK | null;
  gate?: LinkGateSummary | null;
  usesStorage?: boolean;
}) {
  const [data, setData] = useState<DataVisibility>("own");
  return (
    <div className="flex justify-end">
      <AccessInheritedPopover
        inline
        width={from}
        trigger={from === "share" ? <ShareButton /> : <PillButton />}
        link={from === "share" ? link : null}
        collectionName="Design system"
        gate={gate ? { rootName: "Research", gate } : null}
        onOpenCollection={noop}
        usesStorage={usesStorage}
        dataVisibility={data}
        onChooseData={setData}
      />
    </div>
  );
}

export default definePreview({
  title: "Access inherited popover",
  variants: [
    { name: "From Share — Org members, Link at the top", render: () => <Example /> },
    { name: "From Share — Private, no Link", render: () => <Example link={null} /> },
    { name: "From Share — Public with a password and expiry", render: () => <Example gate={gates.both} /> },
    { name: "From Share — Public, link protection expired", render: () => <Example gate={gates.expired} /> },
    { name: "Saves data — Saved data with the current choice", render: () => <Example usesStorage /> },
    { name: "From the access pill — 256px, no Link", render: () => <Example from="pill" /> },
  ],
});
