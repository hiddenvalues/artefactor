import { definePreview } from "../../design/preview";
import { gates, noop } from "../../design/fixtures";
import { LinkProtection } from "./LinkProtection";

const frame = "w-80 rounded-md border bg-popover p-3 text-popover-foreground shadow-md";

export default definePreview({
  title: "Link protection",
  variants: [
    {
      name: "Publishing (making an artefact public)",
      render: () => (
        <div className={frame}>
          <LinkProtection mode="publish" submitLabel="Make public" onSubmit={noop} onCancel={noop} />
        </div>
      ),
    },
    {
      name: "Editing an existing gate",
      render: () => (
        <div className={frame}>
          <LinkProtection mode="edit" current={gates.both} submitLabel="Save" onSubmit={noop} onCancel={noop} />
        </div>
      ),
    },
    {
      name: "Editing an expired link",
      render: () => (
        <div className={frame}>
          <LinkProtection mode="edit" current={gates.expired} submitLabel="Save" onSubmit={noop} onCancel={noop} />
        </div>
      ),
    },
  ],
});
