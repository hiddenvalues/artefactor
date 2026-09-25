import { definePreview } from "../../../design/preview";
import { Label } from "./label";
import { RadioGroup, RadioGroupItem } from "./radio-group";

export default definePreview({
  title: "Radio group",
  variants: [
    {
      name: "States",
      render: () => (
        <RadioGroup defaultValue="private">
          <Label>
            <RadioGroupItem value="private" />
            Private
          </Label>
          <Label>
            <RadioGroupItem value="authenticated" />
            Signed-in users
          </Label>
          <Label>
            <RadioGroupItem value="public" disabled />
            Public (disabled)
          </Label>
        </RadioGroup>
      ),
    },
    {
      name: "Invalid",
      render: () => (
        <RadioGroup>
          <Label>
            <RadioGroupItem value="a" aria-invalid />
            Choose one
          </Label>
          <Label>
            <RadioGroupItem value="b" aria-invalid />
            Or this
          </Label>
        </RadioGroup>
      ),
    },
  ],
});
