import { definePreview } from "../../design/preview";
import { gates } from "../../design/fixtures";
import { LinkGateBadges } from "./LinkGateBadges";

const CASES = [
  ["Password", gates.password],
  ["Expiring", gates.expiring],
  ["Expired", gates.expired],
  ["Password + expiry", gates.both],
  ["No gate (renders nothing)", gates.none],
] as const;

export default definePreview({
  title: "Link gate badges",
  variants: (["chip", "inline"] as const).flatMap((variant) =>
    CASES.map(([name, gate]) => ({
      name: `${variant === "chip" ? "Chip" : "Inline"} — ${name}`,
      render: () => (
        <div className="flex min-h-6 items-center gap-1 rounded-md bg-muted p-2 text-xs">
          <LinkGateBadges gate={gate} variant={variant} />
        </div>
      ),
    })),
  ),
});
