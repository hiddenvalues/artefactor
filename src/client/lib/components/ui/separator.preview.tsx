import { definePreview } from "../../../design/preview";
import { Separator } from "./separator";

export default definePreview({
  title: "Separator",
  variants: [
    {
      name: "Horizontal",
      render: () => (
        <div className="w-64 text-sm">
          <div>Above</div>
          <Separator className="my-3" />
          <div>Below</div>
        </div>
      ),
    },
    {
      name: "Vertical",
      render: () => (
        <div className="flex h-5 items-center gap-3 text-sm">
          <span>Grid</span>
          <Separator orientation="vertical" />
          <span>List</span>
        </div>
      ),
    },
  ],
});
