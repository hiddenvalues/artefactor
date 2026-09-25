import { definePreview } from "../../../design/preview";
import { Launcher } from "../../../design/Launcher";
import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Input } from "./input";
import { Label } from "./label";

export default definePreview({
  title: "Dialog",
  variants: [
    {
      name: "Form dialog",
      render: () => (
        <Launcher label="Open dialog" primary>
          {(close) => (
            <Dialog open onOpenChange={(o) => !o && close()}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename artefact</DialogTitle>
                  <DialogDescription>The new title shows everywhere it is shared.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label htmlFor="dialog-preview-title">Title</Label>
                  <Input id="dialog-preview-title" defaultValue="Onboarding flow prototype" />
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button onClick={close}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </Launcher>
      ),
    },
    {
      name: "Without a close button",
      render: () => (
        <Launcher label="Open bare dialog">
          {(close) => (
            <Dialog open onOpenChange={(o) => !o && close()}>
              <DialogContent showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Uploading…</DialogTitle>
                  <DialogDescription>This closes by itself when done.</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          )}
        </Launcher>
      ),
    },
  ],
});
