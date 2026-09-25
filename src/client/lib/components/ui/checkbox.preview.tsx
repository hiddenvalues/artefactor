import { definePreview } from "../../../design/preview";
import { Checkbox } from "./checkbox";
import { Label } from "./label";

export default definePreview({
  title: "Checkbox",
  variants: [
    {
      name: "States",
      render: () => (
        <>
          <Label>
            <Checkbox />
            Unchecked
          </Label>
          <Label>
            <Checkbox defaultChecked />
            Checked
          </Label>
          <Label>
            <Checkbox disabled />
            Disabled
          </Label>
          <Label>
            <Checkbox disabled defaultChecked />
            Disabled, checked
          </Label>
          <Label>
            <Checkbox aria-invalid />
            Invalid
          </Label>
        </>
      ),
    },
  ],
});
