import { definePreview } from "../../design/preview";
import { Launcher } from "../../design/Launcher";
import { ManageAccessDialog } from "./ManageAccessDialog";

// The catalog's fixture API answers the member list and the directory search
// (try "a"), so the picker works with no server.
export default definePreview({
  title: "Manage access dialog",
  variants: [
    {
      name: "An artefact’s people",
      render: () => (
        <Launcher label="Open for an artefact" primary>
          {(close) => <ManageAccessDialog target={{ kind: "artefact", id: "art-onboarding", title: "Onboarding flow prototype" }} onClose={close} />}
        </Launcher>
      ),
    },
    {
      name: "A collection’s people",
      render: () => (
        <Launcher label="Open for a collection">
          {(close) => <ManageAccessDialog target={{ kind: "collection", id: "col-design", title: "Design system" }} onClose={close} />}
        </Launcher>
      ),
    },
  ],
});
