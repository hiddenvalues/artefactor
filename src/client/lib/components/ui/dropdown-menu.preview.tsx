import { useState } from "react";
import { Archive, Link, MoreHorizontal, Pencil } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { useStandalone } from "../../../design/Launcher";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function Example() {
  const standalone = useStandalone();
  const [bookmarked, setBookmarked] = useState(true);
  const [sort, setSort] = useState("updated");
  return (
    <div className="h-96">
      <DropdownMenu modal={false} defaultOpen={standalone}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Artefact</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <Pencil />
              Edit
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Download (disabled)</DropdownMenuItem>
            <DropdownMenuItem inset>Inset item</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={bookmarked} onCheckedChange={setBookmarked}>
            Bookmarked
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
            <DropdownMenuRadioItem value="updated">Recently updated</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="title">Title A–Z</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Design system</DropdownMenuItem>
              <DropdownMenuItem>Research</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem variant="destructive">
            <Archive />
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default definePreview({
  title: "Dropdown menu",
  variants: [{ name: "Items, checkbox, radio, sub-menu, destructive", render: () => <Example /> }],
});
