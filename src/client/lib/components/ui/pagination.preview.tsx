import { definePreview } from "../../../design/preview";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination";

export default definePreview({
  title: "Pagination",
  variants: [
    {
      name: "Default",
      render: () => (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#ui-pagination" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#ui-pagination">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#ui-pagination" isActive>
                2
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#ui-pagination">3</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#ui-pagination" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ),
    },
  ],
});
