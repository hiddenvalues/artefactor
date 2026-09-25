import { definePreview } from "../../design/preview";
import { Launcher } from "../../design/Launcher";
import { ConfirmDialog } from "./ConfirmDialog";

const copy = {
  title: "Delete “Onboarding flow prototype” permanently?",
  message: "Its file and everyone’s saved data are removed. This can’t be undone.",
};

export default definePreview({
  title: "Confirm dialog",
  variants: [
    {
      name: "Default",
      render: () => (
        <Launcher label="Open confirm" primary>
          {(close) => <ConfirmDialog {...copy} confirmLabel="Delete permanently" onConfirm={close} onClose={close} />}
        </Launcher>
      ),
    },
    {
      name: "Busy",
      render: () => (
        <Launcher label="Open busy confirm">
          {(close) => <ConfirmDialog {...copy} confirmLabel="Deleting…" busy onConfirm={close} onClose={close} />}
        </Launcher>
      ),
    },
  ],
});
