import { Loader2, Plus, Trash2 } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { Button } from "./button";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const SIZES = ["xs", "sm", "default", "lg"] as const;

export default definePreview({
  title: "Button",
  variants: [
    {
      name: "Variants",
      render: () =>
        VARIANTS.map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        )),
    },
    {
      name: "Sizes",
      render: () =>
        SIZES.map((s) => (
          <Button key={s} size={s}>
            Size {s}
          </Button>
        )),
    },
    {
      name: "With icon",
      render: () => (
        <>
          <Button>
            <Plus />
            Upload
          </Button>
          <Button variant="destructive">
            <Trash2 />
            Delete
          </Button>
          <Button variant="outline" size="icon" aria-label="Add">
            <Plus />
          </Button>
        </>
      ),
    },
    {
      name: "States",
      render: () => (
        <>
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled outline
          </Button>
          <Button disabled>
            <Loader2 className="animate-spin" />
            Saving…
          </Button>
        </>
      ),
    },
  ],
});
