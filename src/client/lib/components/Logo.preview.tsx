import type { ReactNode } from "react";
import { noop } from "../../design/fixtures";
import { definePreview } from "../../design/preview";
import { Logo } from "./Logo";

const home = { href: "#", label: "Artefactor, go to Home", onNavigate: noop };

// The medium logo narrows on the top bar's width, so each medium cell sits in a
// top-bar container: as wide as `sm`, or narrower.
const InTopBar = ({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) => (
  <div className="overflow-hidden">
    <div className={narrow ? "@container/top-bar w-[20rem]" : "@container/top-bar w-[40rem]"}>{children}</div>
  </div>
);

export default definePreview({
  title: "Logo",
  variants: [
    {
      name: "Wide, medium (top bar)",
      render: () => (
        <InTopBar>
          <Logo {...home} />
        </InTopBar>
      ),
    },
    { name: "Wide, large (sign-in)", render: () => <Logo size="lg" /> },
    {
      name: "Narrow, medium (top bar below sm)",
      render: () => (
        <InTopBar narrow>
          <Logo {...home} />
        </InTopBar>
      ),
    },
    {
      name: "Not a link",
      render: () => (
        <InTopBar>
          <Logo />
        </InTopBar>
      ),
    },
  ],
});
