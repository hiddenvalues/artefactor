import { definePreview } from "../../design/preview";
import { EmailSentPanel } from "./EmailSentPanel";

const noop = () => {};

export default definePreview({
  title: "Email sent panel",
  variants: [
    { name: "Sign-in link", render: () => <EmailSentPanel kind="sign-in" email="ada@example.com" onBack={noop} /> },
    { name: "Sign-up link", render: () => <EmailSentPanel kind="sign-up" email="ada@example.com" onBack={noop} /> },
    { name: "Reset link", render: () => <EmailSentPanel kind="reset" email="ada@example.com" onBack={noop} /> },
  ],
});
