import { useEffect } from "react";
import { toast } from "sonner";
import { definePreview } from "../../../design/preview";
import { useStandalone } from "../../../design/Launcher";
import { Button } from "./button";

// The catalog mounts the one Toaster (./sonner) for the whole page; these fire
// into it, as the app's `notify` does.
const KINDS = {
  message: () => toast("Link copied"),
  success: () => toast.success("Artefact published"),
  info: () => toast.info("Shared with 3 people"),
  warning: () => toast.warning("The link expires tomorrow"),
  error: () => toast.error("Could not save the change"),
  action: () => toast("Archived “Onboarding flow”", { action: { label: "Undo", onClick: () => {} } }),
} as const;

function Triggers() {
  const standalone = useStandalone();
  useEffect(() => {
    if (standalone) KINDS.action();
  }, [standalone]);
  return (
    <>
      {Object.entries(KINDS).map(([name, fire]) => (
        <Button key={name} variant="outline" onClick={fire}>
          {name}
        </Button>
      ))}
    </>
  );
}

export default definePreview({
  title: "Toast (Sonner)",
  variants: [{ name: "Message, success, info, warning, error, with action", render: () => <Triggers /> }],
});
