# Screen: Auth flow

## Purpose

Get a person into Artefactor: sign in, create an account, or get back in after forgetting a
password. The methods on offer are the deployment's (`GET /api/config`): the S38 method flags, and
the capabilities a superset turns on — magic-link sign-in (S33a), verified sign-up and password
reset (S48). With every capability off, the screen is the OSS one: Google and/or email + password.

## Prototype

None. Built from ALI-429 (S48 — Verified sign-up and password reset affordances); the code and
the slice are the truth.

## Layout

- **Page:** one centred column, at most `max-w-sm` wide, with the large Logo above one Card. The
  column keeps its width on a narrow screen, with 24 px of padding at the edges.
- **Card, sign-in form (the main view), top to bottom:**
  - **Continue with Google** (outline Button with Google's mark).
  - The inline error (`FieldError`), and a muted notice after a password reset.
  - A divider "or continue with email", only when Google is also on.
  - **Sign in / Create account** Tabs, only when sign-up is open.
    `/signin` and `/signup` open on that tab (S73), and on those two paths the tabs keep the
    address in step.
  - The email form: Name (Create account only), Email, Password, **Forgot password?** (a link
    Button, sign-in mode, `passwordReset` on), then the submit Button.
  - The magic-link block (`magicLinkSignIn` on): a divider "or get a sign-in link", an Email field
    and **Email me a sign-in link** (outline Button).
- **Card, other views:** each replaces the whole card body — a short heading and the one form or
  message that view needs, with a link Button back.

## Data per unit

There is no repeated unit. Every value shown is what the person typed; the allowed email domains
are never shown.

| Unit | Shows |
| --- | --- |
| Check-your-inbox panel | The address the link went to |

## Actions

| Action | Where | Does |
| --- | --- | --- |
| Continue with Google | Main view | Google sign-in; back to `returnTo`, else `/` |
| Sign in | Main view, Sign in tab | Email + password sign-in |
| Create account (password) | Main view, Create account tab, `verifiedSignUp` off | `signUp.email` with name, email, password |
| Email me a link to create my account | Create account tab, `verifiedSignUp` on | Emails a link; a new account lands on Set password |
| Email me a sign-in link | Magic-link block | Emails a sign-in link; with `verifiedSignUp`, a new account lands on Set password |
| Forgot password? | Under the password, sign-in mode, `passwordReset` on | Opens Forgot password |
| Send reset link | Forgot password | Emails a reset link to `/?reset-password=1` |
| Reset password | Reset | Sets the new password from the link's token |
| Send a new link | Reset link expired | Opens Forgot password |
| Set password | Set password | Adds a password to the signed-in account, then goes to `returnTo`, else `/` |
| Skip — I'll sign in with email links | Set password | Goes to `returnTo`, else `/`, with no request |
| Use a different email / Back to sign in | Check-your-inbox panel, Forgot password, Reset, Reset link expired | Back to the main view |

Nothing on the screen asks for confirmation: each action is either reversible or only sends mail.

## States

- **Loading:** the card is empty until the config call settles, so no method flashes that the
  server would refuse. A failed call shows Google and email + password with sign-up open.
- **Sign-in:** the main view as laid out above. Without the magic link, the block is gone.
  Without reset, there is no **Forgot password?**.
- **Create account by link** (`verifiedSignUp` on): the Create account tab asks for Name and
  Email only. Its button reads "Email me a link to create my account", and the magic-link block
  is hidden, because the button already sends one.
- **Link sent** (`EmailSentPanel`): the card shows only the message and a way back. The message
  never says whether the address has an account:
  - sign-in: "Check your inbox — we sent a sign-in link to `<email>`";
  - sign-up: "Check your inbox — we sent a link to `<email>`. Open it to finish creating your
    account.";
  - reset: "If an account exists for `<email>`, we sent a reset link".
- **Set password** (a separate screen, the welcome landing): heading "Choose a password",
  `NewPasswordForm` (New password, Confirm password, **Set password**), and **Skip**. Errors are
  inline:
  - a mismatch is caught before sending;
  - a too-short or too-long password gets its message;
  - "This account already has a password";
  - "For your security, sign in again with a link to set a password";
  - anything else gets a generic message.
- **Forgot password:** heading "Reset your password", Email, **Send reset link**, and **Back to
  sign in**. A rate-limited send is an inline error, with the form still usable.
- **Reset:** heading "Choose a new password", `NewPasswordForm` with **Reset password**, and
  **Back to sign in**.
- **Reset link expired or used:** the inline error "That reset link has expired or was already
  used", with **Send a new link** and **Back to sign in**.
- **Password updated:** the sign-in form in sign-in mode, with the muted notice "Password updated
  — sign in with your new password". The next sign-in lands in the app. A visitor who was signed
  in stays on this form: the reset signed out every session.
- **Errors on landing:**
  - A failed Google sign-in is explained inline.
  - A failed magic-link verify (magic link on) reads "That sign-in link has expired or was already
    used — send a new one", or "We couldn't sign you in with that link".
  - A link whose account the deployment won't create (magic link on) reads "We couldn't create an
    account for that address — sign-up isn't open to it here". It never says which rule refused.
  - A reset link's error is never read as a sign-in link's.

## Navigation

- **Arriving:**
  - Signed out, at any URL: the sign-in form.
  - From an MCP client's authorize request (S63), signed out, at `/?…&sig=…`: the sign-in form.
    Any sign-in resumes the request, which lands on Consent rather than the app. An emailed
    sign-in or sign-up link carries the request, so following it lands on Consent too (after Set
    password, for a new account where the deployment offers it). Once the request has expired
    (or the provider refuses its signature on a sign-in), the card shows Consent's expired state
    in its place: "This connection request has expired.", "Start connecting again from
    Claude.", and a link Button **Sign in without connecting** that reloads the bare `/`.
  - From a gated artefact link, as `/?returnTo=/a/<slug>`: a successful sign-in goes back there.
  - From a reset email, at `/?reset-password=1&token=…` (or `&error=INVALID_TOKEN`): Reset, or
    Reset link expired, whether or not a session exists.
  - From a first link sign-in, at `/?welcome=set-password[&returnTo=…]`: Set password, when the
    deployment offers verified sign-up. Otherwise the param is ignored.
- **Leaving:**
  - A sign-in goes to the app (or `returnTo`), or to Consent while an authorize request is pending.
  - Set password goes to `returnTo`, else `/`, with the landing query stripped.
- **Back:** every view other than the main one has a link Button back to the sign-in form. The
  landing query is removed from the address bar once it has been read.

## Consent (MCP connector)

S63 — MCP connector on better-auth 1.7: OAuth provider with a consent screen. When an MCP client
such as claude.ai connects, the OAuth provider sends the signed-in person to `/oauth/consent` with
a signed query. The screen asks them to let that client act as them (`identity.mcp.consent-required`).

- **Layout:** the sign-in card's page: one centred `max-w-sm` column, the large Logo above one
  Card. Top to bottom:
  - heading "Connect `<client>` to Artefactor?", where `<client>` is the client's registered
    name, falling back to its client id;
  - a muted line, "`<client>` will act as `<email>`", with the email in the foreground colour;
  - a muted line, "It will send you back to `<host>`.", where `<host>` is the host of the
    redirect URI in the signed query (the place the code goes), in the foreground colour, since
    the name is whatever the client chose for itself;
  - the grant, in one sentence: "It will be able to create, read, update, share and archive your
    artefacts, and read and write their saved data, as you.";
  - **Allow** (default Button) above **Deny** (outline Button), both full width.
- **States:**
  - **Loading:** a muted "Loading…" in the card while the provider checks the signed query and
    names the client.
  - **Ready:** as laid out above. While Allow or Deny is posting, both Buttons are disabled.
  - **Expired:** an expired, missing or tampered query, or a POST the provider refuses. Heading
    "This connection request has expired.", the muted line "Start connecting again from
    Claude.", and a link Button **Go to Home**. There is no Allow.
- **Actions:** **Allow** accepts, and the browser goes back to the client with a code. **Deny**
  refuses, and the browser goes back to the client with `error=access_denied`. Neither asks for
  confirmation: Deny only ends this attempt, and the client can ask again.
- **Signed out** at `/oauth/consent`: the sign-in form, which resumes the request onto this screen.

## Non-goals

- A signed-in page to change or add a password (account settings).
- Verifying the address after a password sign-up (`requireEmailVerification`).
- Password strength beyond the server's length bounds, and breached-password checks.
- Sending any mail: the endpoints behind link sign-up, set password and reset are a superset's
  (EI4 — Verified password sign-up and password reset).
- A list of connected MCP clients, revoking a grant, or choosing finer scopes on Consent.
