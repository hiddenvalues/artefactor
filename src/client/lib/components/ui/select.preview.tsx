import { definePreview } from "../../../design/preview";
import { useStandalone } from "../../../design/Launcher";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "./select";

function Example({ size = "default", primary = false }: { size?: "sm" | "default"; primary?: boolean }) {
  const standalone = useStandalone();
  return (
    <Select defaultValue="7d" defaultOpen={standalone && primary}>
      <SelectTrigger size={size} className="w-48" aria-label="Link expiry">
        <SelectValue placeholder="Expires" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Expires after</SelectLabel>
          <SelectItem value="1d">1 day</SelectItem>
          <SelectItem value="7d">7 days</SelectItem>
          <SelectItem value="30d">30 days</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="never" disabled>
          Never (disabled)
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

export default definePreview({
  title: "Select",
  variants: [
    {
      name: "Default",
      render: () => (
        <div className="h-56">
          <Example primary />
        </div>
      ),
    },
    { name: "Small", render: () => <Example size="sm" /> },
    {
      name: "Placeholder, disabled",
      render: () => (
        <Select disabled>
          <SelectTrigger className="w-48" aria-label="Duration">
            <SelectValue placeholder="Pick a duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">1 day</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      name: "Invalid",
      render: () => (
        <Select>
          <SelectTrigger className="w-48" aria-label="Duration" aria-invalid>
            <SelectValue placeholder="Required" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">1 day</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ],
});
