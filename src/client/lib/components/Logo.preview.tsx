import { definePreview } from "../../design/preview";
import { Logo } from "./Logo";

export default definePreview({
  title: "Logo",
  variants: [
    { name: "Medium (top bar)", render: () => <Logo /> },
    { name: "Large (sign-in)", render: () => <Logo size="lg" /> },
  ],
});
