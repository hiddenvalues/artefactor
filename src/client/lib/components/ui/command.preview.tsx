import { FileText, FolderClosed, Settings } from "lucide-react";
import { definePreview } from "../../../design/preview";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command";

function Example({ value, query, status }: { value?: string; query?: string; status?: string }) {
  return (
    <Command shouldFilter={!status} value={value} className="w-80 rounded-lg border shadow-md">
      <CommandInput placeholder="Search artefacts…" value={query} aria-label="Search artefacts" />
      <CommandList>
        <CommandEmpty>{status ? <span role="status">{status}</span> : "No results."}</CommandEmpty>
        {!status && (
          <>
            <CommandGroup heading="Artefacts">
              <CommandItem value="pricing">
                <FileText />
                Pricing experiment
              </CommandItem>
              <CommandItem value="roadmap">
                <FileText />
                Q4 roadmap
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              <CommandItem value="collections">
                <FolderClosed />
                Collections
              </CommandItem>
              <CommandItem value="settings">
                <Settings />
                Settings
                <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
}

export default definePreview({
  title: "Command",
  variants: [
    { name: "Default", render: () => <Example /> },
    { name: "Item highlighted", render: () => <Example value="roadmap" /> },
    { name: "Empty", render: () => <Example query="zzz" /> },
    { name: "Loading", render: () => <Example query="pri" status="Searching…" /> },
  ],
});
