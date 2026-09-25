import { Bold, Bookmark } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { Toggle } from "./toggle";

const SIZES = ["sm", "default", "lg"] as const;

export default definePreview({
  title: "Toggle",
  variants: [
    {
      name: "Variants",
      render: () => (
        <>
          <Toggle aria-label="Bold">
            <Bold />
          </Toggle>
          <Toggle variant="outline">
            <Bookmark />
            Bookmark
          </Toggle>
        </>
      ),
    },
    {
      name: "Sizes",
      render: () =>
        SIZES.map((s) => (
          <Toggle key={s} size={s} variant="outline">
            {s}
          </Toggle>
        )),
    },
    {
      name: "States",
      render: () => (
        <>
          <Toggle variant="outline" defaultPressed>
            Pressed
          </Toggle>
          <Toggle variant="outline" disabled>
            Disabled
          </Toggle>
        </>
      ),
    },
  ],
});
