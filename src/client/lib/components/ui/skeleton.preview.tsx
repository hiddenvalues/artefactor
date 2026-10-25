import { definePreview } from "../../../design/preview";
import { Skeleton } from "./skeleton";

export default definePreview({
  title: "Skeleton",
  variants: [
    {
      name: "Card",
      render: () => (
        <div className="flex w-60 flex-col gap-3">
          <Skeleton className="aspect-[16/10] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ),
    },
    {
      name: "Row",
      render: () => (
        <div className="flex w-full items-center gap-3.5">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ),
    },
  ],
});
