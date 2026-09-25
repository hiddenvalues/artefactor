import { definePreview } from "../../../design/preview";
import { Textarea } from "./textarea";

// Each field carries an accessible name, as it must in the app.
export default definePreview({
  title: "Textarea",
  variants: [
    { name: "Empty", render: () => <Textarea className="w-80" aria-label="Description" placeholder="Describe the change…" /> },
    { name: "Filled", render: () => <Textarea className="w-80" aria-label="Notes" defaultValue={"A longer note\nthat spans lines."} /> },
    { name: "Disabled", render: () => <Textarea className="w-80" aria-label="Notes (read only)" disabled defaultValue="Read only" /> },
    { name: "Invalid", render: () => <Textarea className="w-80" aria-label="Description" aria-invalid /> },
  ],
});
