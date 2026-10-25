import { definePreview } from "../../design/preview";
import { NewPasswordForm, PASSWORD_MISMATCH, passwordErrorMessage } from "./NewPasswordForm";

const noop = () => {};

export default definePreview({
  title: "New password form",
  variants: [
    { name: "Empty", render: () => <NewPasswordForm submitLabel="Set password" onSubmit={noop} /> },
    { name: "Busy", render: () => <NewPasswordForm submitLabel="Set password" busy onSubmit={noop} /> },
    {
      name: "Mismatch",
      render: () => <NewPasswordForm submitLabel="Reset password" error={PASSWORD_MISMATCH} onSubmit={noop} />,
    },
    {
      name: "Server error",
      render: () => (
        <NewPasswordForm
          submitLabel="Set password"
          error={passwordErrorMessage("PASSWORD_TOO_SHORT", "We couldn't set your password. Try again.")}
          onSubmit={noop}
        />
      ),
    },
  ],
});
