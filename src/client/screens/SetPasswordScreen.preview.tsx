import { definePreview } from "../design/preview";
import { PageFrame } from "../design/ScreenFrame";
import { SetPasswordScreen } from "./SetPasswordScreen";

// S70 — the welcome landing after a verified sign-up (S48), outside the
// signed-in frame (docs/design/templates/auth-flow.md).
export default definePreview({
  title: "Set password",
  variants: [
    {
      name: "Choose a password",
      render: () => (
        <PageFrame>
          <SetPasswordScreen />
        </PageFrame>
      ),
    },
  ],
});
