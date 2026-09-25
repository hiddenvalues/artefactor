import { definePreview } from "../../../design/preview";
import { useStandalone } from "../../../design/Launcher";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./popover";

function Example() {
  const standalone = useStandalone();
  return (
    <div className="h-40">
      <Popover defaultOpen={standalone}>
        <PopoverTrigger asChild>
          <Button variant="outline">Open popover</Button>
        </PopoverTrigger>
        <PopoverContent align="start">
          <PopoverHeader>
            <PopoverTitle>Who can open this</PopoverTitle>
            <PopoverDescription>Only you, until you share it.</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default definePreview({
  title: "Popover",
  variants: [{ name: "Header, title and description", render: () => <Example /> }],
});
