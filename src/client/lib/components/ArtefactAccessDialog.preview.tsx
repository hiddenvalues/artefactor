import type { ArtefactSummary } from "../../../shared/contracts";
import { definePreview } from "../../design/preview";
import { Launcher } from "../../design/Launcher";
import { artefact, gates, noop, people } from "../../design/fixtures";
import { chooseLevel, type AccessDraft } from "../access-dialog";
import { enablePassword } from "../link-protection";
import { ArtefactAccessDialog, type AccessDialogInitial } from "./ArtefactAccessDialog";

// S55 — the hand-back's States, each opened part-way through an edit. The
// catalog's fixture API answers the directory search (try "a"); nothing saves.

const PRIVATE = artefact();
const SELECTED = artefact({ visibility: "selected", publicSlug: "0nb0ard1ng" });
const MEMBERS = artefact({ visibility: "authenticated", publicSlug: "0nb0ard1ng", usesStorage: true });
const PUBLIC = artefact({ visibility: "public", publicSlug: "0nb0ard1ng", usesStorage: true });
const PROTECTED = { ...PUBLIC, linkGate: gates.both };

function dialog(label: string, a: ArtefactSummary, initial: AccessDialogInitial, primary = false) {
  return {
    name: label,
    render: () => (
      <Launcher label={`Open: ${label}`} primary={primary}>
        {(close) => <ArtefactAccessDialog artefact={a} onClose={close} onSaved={noop} initial={initial} />}
      </Launcher>
    ),
  };
}

const to = (level: AccessDraft["level"]) => (saved: AccessDraft) => chooseLevel(saved, saved, level);
const withPassword = (password: string) => (saved: AccessDraft) => {
  const d = chooseLevel(saved, saved, "public");
  return { ...d, gate: { ...d.gate, form: { ...enablePassword(d.gate.form), password } } };
};

export default definePreview({
  title: "Artefact access dialog",
  variants: [
    dialog("Private", PRIVATE, { members: [] }, true),
    dialog("Specific people, with viewers", SELECTED, { members: [people[0]!, people[1]!] }),
    dialog("Specific people, no remembered viewers", PRIVATE, { members: [], draft: to("selected") }),
    dialog("Searching", SELECTED, { members: [people[0]!], query: "a" }),
    dialog("Searching, no people found", SELECTED, { members: [], query: "zzz" }),
    dialog("Org members, with saved data", MEMBERS, { members: [] }),
    dialog("Public, no protection", PUBLIC, { members: [] }),
    dialog("Public, protected", PROTECTED, { members: [] }),
    dialog("New password, shown once", PRIVATE, { members: [], draft: withPassword("Tq7mWx4pKd9sRb2n") }),
    dialog("Invalid protection", PRIVATE, { members: [], draft: withPassword("abcde") }),
    dialog("Level list open", PROTECTED, { members: [], levelsOpen: true }),
    dialog("Loading", SELECTED, { members: null }),
  ],
});
