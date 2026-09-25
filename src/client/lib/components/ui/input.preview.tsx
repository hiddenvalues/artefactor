import { definePreview } from "../../../design/preview";
import { Input } from "./input";

// Each field carries an accessible name, as it must in the app.
export default definePreview({
  title: "Input",
  variants: [
    { name: "Empty", render: () => <Input className="w-64" aria-label="Search artefacts" placeholder="Search artefacts…" /> },
    { name: "Filled", render: () => <Input className="w-64" aria-label="Title" defaultValue="Onboarding flow" /> },
    { name: "Password", render: () => <Input className="w-64" aria-label="Password" type="password" defaultValue="correct-horse" /> },
    { name: "File", render: () => <Input className="w-64" aria-label="HTML file" type="file" /> },
    { name: "Disabled", render: () => <Input className="w-64" aria-label="Title (read only)" disabled defaultValue="Read only" /> },
    { name: "Invalid", render: () => <Input className="w-64" aria-label="Title" aria-invalid placeholder="Required" /> },
  ],
});
