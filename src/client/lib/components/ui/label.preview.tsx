import { definePreview } from "../../../design/preview";
import { Input } from "./input";
import { Label } from "./label";

export default definePreview({
  title: "Label",
  variants: [
    { name: "Plain", render: () => <Label>Title</Label> },
    {
      name: "With a field",
      render: () => (
        <div className="grid w-64 gap-2">
          <Label htmlFor="label-preview">Title</Label>
          <Input id="label-preview" placeholder="Name your artefact" />
        </div>
      ),
    },
    {
      name: "Disabled field",
      render: () => (
        <div className="group grid w-64 gap-2" data-disabled="true">
          <Label htmlFor="label-preview-off">Title</Label>
          <Input id="label-preview-off" disabled />
        </div>
      ),
    },
  ],
});
