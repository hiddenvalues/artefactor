import { definePreview } from "../../../design/preview";
import { Input } from "./input";

export default definePreview({
  title: "Input",
  variants: [
    { name: "Empty", render: () => <Input className="w-64" placeholder="Search artefacts…" /> },
    { name: "Filled", render: () => <Input className="w-64" defaultValue="Onboarding flow" /> },
    { name: "Password", render: () => <Input className="w-64" type="password" defaultValue="correct-horse" /> },
    { name: "File", render: () => <Input className="w-64" type="file" /> },
    { name: "Disabled", render: () => <Input className="w-64" disabled defaultValue="Read only" /> },
    { name: "Invalid", render: () => <Input className="w-64" aria-invalid placeholder="Required" /> },
  ],
});
