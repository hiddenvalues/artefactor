import { definePreview } from "../design/preview";
import { PageFrame } from "../design/ScreenFrame";
import { AuthScreen } from "./AuthScreen";

// S70 — the sign-in screen, outside the signed-in frame
// (docs/design/templates/auth-flow.md). The fixture API answers `/api/config`
// with every method on: email + password, Google and the magic link.
export default definePreview({
  title: "Sign in",
  variants: [
    {
      name: "Every method",
      render: () => (
        <PageFrame>
          <AuthScreen />
        </PageFrame>
      ),
    },
  ],
});
