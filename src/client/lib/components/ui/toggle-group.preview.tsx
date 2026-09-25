import { LayoutGrid, List } from "lucide-react";
import { definePreview } from "../../../design/preview";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

export default definePreview({
  title: "Toggle group",
  variants: [
    {
      name: "Single, outline",
      render: () => (
        <ToggleGroup type="single" variant="outline" defaultValue="grid">
          <ToggleGroupItem value="grid" aria-label="Grid">
            <LayoutGrid />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List">
            <List />
          </ToggleGroupItem>
        </ToggleGroup>
      ),
    },
    {
      name: "Multiple, default",
      render: () => (
        <ToggleGroup type="multiple" defaultValue={["prototype"]}>
          <ToggleGroupItem value="prototype">Prototype</ToggleGroupItem>
          <ToggleGroupItem value="form">Form</ToggleGroupItem>
          <ToggleGroupItem value="deck">Deck</ToggleGroupItem>
        </ToggleGroup>
      ),
    },
    {
      name: "Small, with a disabled item",
      render: () => (
        <ToggleGroup type="single" size="sm" variant="outline" defaultValue="one">
          <ToggleGroupItem value="one">One</ToggleGroupItem>
          <ToggleGroupItem value="two" disabled>
            Two
          </ToggleGroupItem>
        </ToggleGroup>
      ),
    },
  ],
});
