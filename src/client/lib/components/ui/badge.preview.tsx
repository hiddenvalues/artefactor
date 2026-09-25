import { Check } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { Badge } from "./badge";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

export default definePreview({
  title: "Badge",
  variants: [
    {
      name: "Variants",
      render: () =>
        VARIANTS.map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        )),
    },
    {
      name: "With icon",
      render: () => (
        <Badge variant="secondary">
          <Check />
          Saved
        </Badge>
      ),
    },
    {
      name: "As a link",
      render: () => (
        <Badge asChild>
          <a href="#ui-badge">Link badge</a>
        </Badge>
      ),
    },
  ],
});
