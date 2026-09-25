import { Archive } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { Launcher } from "../../../design/Launcher";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./alert-dialog";

function Example({ size, media = false, close }: { size: "default" | "sm"; media?: boolean; close: () => void }) {
  return (
    <AlertDialog open onOpenChange={(o) => !o && close()}>
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          {media && (
            <AlertDialogMedia>
              <Archive />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
          <AlertDialogDescription>The artefact, its file and everyone’s saved data go for good.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={close}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default definePreview({
  title: "Alert dialog",
  variants: [
    {
      name: "Default",
      render: () => (
        <Launcher label="Open alert dialog" primary>
          {(close) => <Example size="default" close={close} />}
        </Launcher>
      ),
    },
    {
      name: "Small, with media",
      render: () => <Launcher label="Open small alert dialog">{(close) => <Example size="sm" media close={close} />}</Launcher>,
    },
  ],
});
