import { useState } from "react";
import type { AccessFilter, Density, KindFilter } from "$lib/browse";
import { isShared, type HomeItem, type HomeScope, type HomeSort } from "$lib/home";
import { noop, ownedLibrary, ownedProps, sharedLibrary, sharedProps, views } from "../design/fixtures";
import { definePreview } from "../design/preview";
import { ScreenFrame } from "../design/ScreenFrame";
import { Home } from "./Home";

// S70 — Home inside the app frame (docs/design/templates/home.md).
const itemProps = (a: HomeItem) => (isShared(a) ? sharedProps(a) : ownedProps(a));

function Example({
  density: initialDensity = "grid",
  empty = false,
  initial = {},
}: {
  density?: Density;
  empty?: boolean;
  initial?: { scope?: HomeScope; kind?: KindFilter; access?: AccessFilter };
}) {
  const [scope, setScope] = useState<HomeScope>(initial.scope ?? "all");
  const [kind, setKind] = useState<KindFilter>(initial.kind ?? "all");
  const [access, setAccess] = useState<AccessFilter>(initial.access ?? "all");
  const [sort, setSort] = useState<HomeSort>("updated");
  const [density, setDensity] = useState<Density>(initialDensity);
  return (
    <ScreenFrame view="dashboard" empty={empty}>
      <Home
        owned={empty ? [] : ownedLibrary}
        shared={empty ? [] : sharedLibrary}
        views={views}
        loaded
        scope={scope}
        onScope={setScope}
        kind={kind}
        onKind={setKind}
        access={access}
        onAccess={setAccess}
        sort={sort}
        onSort={setSort}
        density={density}
        onDensity={setDensity}
        itemProps={itemProps}
        onUpload={noop}
      />
    </ScreenFrame>
  );
}

export default definePreview({
  title: "Home",
  variants: [
    { name: "Cards", render: () => <Example /> },
    { name: "List", render: () => <Example density="list" /> },
    { name: "Empty (first use)", render: () => <Example empty /> },
    { name: "Filtered to nothing", render: () => <Example initial={{ scope: "mine", kind: "form", access: "private" }} /> },
  ],
});
