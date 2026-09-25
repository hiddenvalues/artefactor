import { definePreview } from "../../../design/preview";
import { useStandalone } from "../../../design/Launcher";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

function Example({ side, primary = false }: { side: "top" | "right" | "bottom" | "left"; primary?: boolean }) {
  const standalone = useStandalone();
  return (
    <Tooltip defaultOpen={standalone && primary}>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover ({side})</Button>
      </TooltipTrigger>
      <TooltipContent side={side}>Copy the share link</TooltipContent>
    </Tooltip>
  );
}

export default definePreview({
  title: "Tooltip",
  variants: [
    {
      name: "Sides",
      render: () => (
        <div className="flex gap-3 py-8">
          <Example side="top" primary />
          <Example side="right" />
          <Example side="bottom" />
          <Example side="left" />
        </div>
      ),
    },
  ],
});
