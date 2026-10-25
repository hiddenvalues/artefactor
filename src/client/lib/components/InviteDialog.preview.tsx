import { definePreview } from "../../design/preview";
import { Launcher } from "../../design/Launcher";
import { InviteDialog } from "./InviteDialog";

// S58 — "Invite people". A send resolves after a beat and closes the preview.
const domains = ["hiddenvalue.se", "example.com"];
const after = (close: () => void) => () =>
  new Promise<null>((done) =>
    setTimeout(() => {
      close();
      done(null);
    }, 400),
  );

export default definePreview({
  title: "Invite dialog",
  variants: [
    {
      name: "Default",
      render: () => (
        <Launcher label="Open invite" primary>
          {(close) => <InviteDialog domains={domains} onSend={after(close)} onClose={close} />}
        </Launcher>
      ),
    },
    {
      name: "Outside the invite domains",
      render: () => (
        <Launcher label="Open with an outside address">
          {(close) => <InviteDialog domains={domains} initialEmail="ada@elsewhere.org" onSend={after(close)} onClose={close} />}
        </Launcher>
      ),
    },
    {
      name: "Refused: already invited",
      render: () => (
        <Launcher label="Open with a refusal">
          {(close) => (
            <InviteDialog
              domains={domains}
              initialEmail="grace@example.com"
              initialRefusal="already-invited"
              onSend={after(close)}
              onClose={close}
            />
          )}
        </Launcher>
      ),
    },
    {
      name: "Refused: already a member",
      render: () => (
        <Launcher label="Open with a member's address">
          {(close) => (
            <InviteDialog
              domains={["hiddenvalue.se"]}
              initialEmail="ada@hiddenvalue.se"
              initialRefusal="already-member"
              onSend={after(close)}
              onClose={close}
            />
          )}
        </Launcher>
      ),
    },
  ],
});
