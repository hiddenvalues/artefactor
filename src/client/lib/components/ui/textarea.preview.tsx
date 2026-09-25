import { definePreview } from "../../../design/preview";
import { Textarea } from "./textarea";

export default definePreview({
  title: "Textarea",
  variants: [
    { name: "Empty", render: () => <Textarea className="w-80" placeholder="Describe the change…" /> },
    { name: "Filled", render: () => <Textarea className="w-80" defaultValue={"A longer note\nthat spans lines."} /> },
    { name: "Disabled", render: () => <Textarea className="w-80" disabled defaultValue="Read only" /> },
    { name: "Invalid", render: () => <Textarea className="w-80" aria-invalid /> },
  ],
});
