import { Fragment, useEffect, useState, type FormEvent } from "react";
import type { LegalLinks, PublicConfigResponse } from "../../shared/contracts";
import { api } from "$lib/api";
import { authClient, signIn, signUp } from "$lib/auth";
import { EmailSentPanel, type EmailSentKind } from "$lib/components/EmailSentPanel";
import { Logo } from "$lib/components/Logo";
import { NewPasswordForm, passwordErrorMessage } from "$lib/components/NewPasswordForm";
import { FieldError } from "$lib/components/UploadDialog";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent } from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Separator } from "$lib/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "$lib/components/ui/tabs";
import {
  RESET_PARAM,
  RESET_REDIRECT,
  hasSignedOAuthQuery,
  pendingAuthorizeURL,
  refusesSignedOAuthQuery,
  signedOAuthQueryExpired,
  readReturnTo,
  signInReturnTo,
  welcomeURL,
} from "$lib/return-to";
import { authModePath, authPath, type AuthMode } from "$lib/auth-paths";

// If the config call fails, show both methods with sign-up open — the server
// rejects whatever isn't configured, so failing this way never hides a method
// that works.
const FALLBACK: PublicConfigResponse = {
  emailPasswordEnabled: true,
  googleEnabled: true,
  signupAllowed: true,
  capabilities: { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false },
  legal: { termsUrl: null, privacyUrl: null },
};

// A gated artefact link redirects here as `/?returnTo=/a/<slug>`; a screen's
// path (`/account`, `/c/<id>`) renders this screen in place (S59). Capture
// either before the landing cleanup strips the query (signInReturnTo); after a
// successful sign-in, by any method, we send the user back there. `/signin` and
// `/signup` (S73) are no screen to return to, so there only `?returnTo=` counts.

// A failed sign-in bounces back here via errorCallbackURL. Google's is marked
// `auth_error` (e.g. an account outside the allowed email domains, blocked by
// the server-side allowlist); a failed magic-link verify (S33a) carries only
// BetterAuth's `error` code.
interface Landing {
  google: boolean;
  detail: string | null;
}

function readLanding(): Landing | null {
  const params = new URLSearchParams(window.location.search);
  // S48 — a reset link's own `error` is the reset view's, never a sign-in's.
  if (params.has(RESET_PARAM)) return null;
  const detail = params.get("error_description") || params.get("error");
  if (!params.has("auth_error") && !detail) return null;
  return { google: params.has("auth_error"), detail };
}

// Surface the real reason BetterAuth reports rather than assuming the cause.
function googleError({ detail }: Landing): string {
  return detail
    ? `Google sign-in failed: ${decodeURIComponent(detail).replace(/[_+]/g, " ")}`
    : "Google sign-in failed. Make sure you're using an authorized account.";
}

// S33a — BetterAuth's verify reports a spent or expired link as INVALID_TOKEN;
// EXPIRED_TOKEN reads the same. A link whose account the sign-up gate refused
// lands as `signup_refused`, named in generic words only (the sign-up gate,
// S38). Without the capability, a bare `?error` keeps reading as a Google
// failure, exactly as before.
const SPENT_LINK = new Set(["EXPIRED_TOKEN", "INVALID_TOKEN"]);

// r[impl identity.auth-screen.signup-refused]
// r[impl hosting.magic-link.landing-error]
function landingError(landing: Landing, magicLinkSignIn: boolean): string {
  if (landing.google || !magicLinkSignIn) return googleError(landing);
  if (landing.detail === "signup_refused")
    return "We couldn't create an account for that address — sign-up isn't open to it here";
  return landing.detail && SPENT_LINK.has(landing.detail)
    ? "That sign-in link has expired or was already used — send a new one"
    : "We couldn't sign you in with that link";
}

// S48 — BetterAuth's reset callback lands on RESET_REDIRECT with `token` for a
// live link, or `error=INVALID_TOKEN` for a spent or expired one.
interface ResetLanding {
  token: string | null;
}

// r[impl identity.auth-screen.reset-landing]
function readResetLanding(): ResetLanding | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(RESET_PARAM)) return null;
  return { token: params.has("error") ? null : params.get("token") };
}

// The card's views besides the sign-in form: asking for a reset link, choosing
// the new password, and a reset link that no longer works.
type View = "main" | "forgot" | "reset" | "reset-expired";

function GoogleMark() {
  // Google's brand mark keeps its own colours: an image, not UI colour.
  return <img src="/google-g.svg" alt="" className="size-4" />;
}

// S67 — "By continuing you agree to the Terms and acknowledge the Privacy
// notice", naming only the documents this deployment links; nothing at all when
// it links neither. A privacy notice informs, so it is acknowledged, not agreed
// to. Each opens in a new tab, so the form, returnTo and a pending connect stay.
// r[impl identity.auth-screen.legal-notice+2]
function LegalNotice({ legal }: { legal: LegalLinks | undefined }) {
  const parts = [
    legal?.termsUrl ? { verb: "agree to", href: legal.termsUrl, label: "Terms" } : null,
    legal?.privacyUrl ? { verb: "acknowledge", href: legal.privacyUrl, label: "Privacy notice" } : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return null;
  return (
    <p className="text-center text-xs text-muted-foreground">
      By continuing you{" "}
      {parts.map((p, i) => (
        <Fragment key={p.label}>
          {i > 0 && " and "}
          {p.verb} the{" "}
          <a
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {p.label}
          </a>
        </Fragment>
      ))}
      .
    </p>
  );
}

// S48 — the session gate hands a reset landing its end: called once a reset
// succeeds, or the visitor goes back to sign in, so a later sign-in lands in
// the app.
export function AuthScreen({ onLandingDone }: { onLandingDone?: () => void }) {
  // S38 — which methods this deployment accepts is *server* configuration, read
  // from GET /api/config on mount. Enforcement stays server-side; these flags
  // only decide what is worth rendering. Until the call settles, render no
  // method rather than flashing one the server would reject.
  const [config, setConfig] = useState<PublicConfigResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const cfg = config ?? FALLBACK;
  // S73 — `/signin` and `/signup` are no screen to come back to: a sign-in from
  // either lands on `/` unless an explicit `?returnTo=` says otherwise.
  const [returnTo] = useState(() => (authPath() ? readReturnTo() : signInReturnTo()));
  const [landing] = useState(readLanding);
  const [resetLanding] = useState(readResetLanding);
  // S73 — the path picks the opening tab; with no tabs (sign-up closed, or no
  // email+password form to hold them) it is always Sign in, so `/signup` can't
  // hide the magic-link block that creates accounts there.
  const [chosenMode, setMode] = useState<AuthMode>(() => authPath() ?? "sign-in");
  const tabsShown = cfg.emailPasswordEnabled && cfg.signupAllowed;
  const mode: AuthMode = tabsShown ? chosenMode : "sign-in";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A Google landing reads at once; any other `?error` waits for the config to
  // say whether it can be a magic link's (S33a).
  const [error, setError] = useState<string | null>(() => (landing?.google ? googleError(landing) : null));
  const [busy, setBusy] = useState(false);
  // S33a — the magic-link form: its own email and send error. A sent link (a
  // sign-in, sign-up or reset one, S48) swaps the card for the check-your-inbox
  // state.
  const [linkEmail, setLinkEmail] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ kind: EmailSentKind; email: string } | null>(null);
  // r[impl hosting.magic-link.sign-in-control]
  const magicLinkSignIn = cfg.capabilities?.magicLinkSignIn === true;
  // S48 — the reset views, their error, and the notice after a reset.
  const [view, setView] = useState<View>(() => (resetLanding ? (resetLanding.token ? "reset" : "reset-expired") : "main"));
  const [resetError, setResetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // S63 — a pending MCP connect whose signed request lapsed (or was refused):
  // every auth POST from this page would fail, so the card says so instead.
  const [connectExpired, setConnectExpired] = useState(() => signedOAuthQueryExpired());
  const verifiedSignUp = cfg.capabilities?.verifiedSignUp === true;
  const passwordReset = cfg.capabilities?.passwordReset === true;
  // r[impl identity.auth-screen.verified-sign-up]
  const linkSignUp = verifiedSignUp && mode === "sign-up";
  // A reset landing is honoured only where the deployment offers reset.
  const shown: View = view !== "main" && !passwordReset ? "main" : view;

  useEffect(() => {
    if (landing || resetLanding) window.history.replaceState({}, "", window.location.pathname);
    api
      .config()
      .then(setConfig)
      .catch(() => {
        /* leave null → FALLBACK (both methods, sign-up open) */
      })
      .finally(() => setConfigLoaded(true));
  }, [landing, resetLanding]);

  useEffect(() => {
    if (configLoaded && landing && !landing.google) setError(landingError(landing, magicLinkSignIn));
  }, [configLoaded, landing, magicLinkSignIn]);

  async function google() {
    setError(null);
    setBusy(true);
    try {
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnTo ?? "/",
        errorCallbackURL: returnTo ? `/?auth_error=1&returnTo=${encodeURIComponent(returnTo)}` : "/?auth_error=1",
      });
      if (refusesSignedOAuthQuery(res.error)) setConnectExpired(true);
      else if (res.error) setError(res.error.message ?? "Google sign-in failed.");
    } catch {
      setError("Google sign-in failed. Check your connection and try again.");
    } finally {
      // On success the browser is already on its way to Google; this only
      // matters when the redirect didn't start.
      setBusy(false);
    }
  }

  // S33a — BetterAuth's magic link. A sent link never says whether the address
  // has an account, and neither does a failed send: its message stays generic.
  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setLinkError(null);
    setBusy(true);
    // S63 — a pending MCP connect rides in the link (`pendingAuthorizeURL`).
    const linkReturnTo = pendingAuthorizeURL() ?? returnTo;
    const destination = linkReturnTo ?? "/";
    try {
      const res = await authClient.signIn.magicLink({
        email: linkEmail,
        callbackURL: destination,
        // S48 — one rule: a new account's first landing offers a password.
        newUserCallbackURL: verifiedSignUp ? welcomeURL(linkReturnTo) : destination,
        errorCallbackURL: returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : "/",
      });
      if (!res.error) setSent({ kind: "sign-in", email: linkEmail });
      else if (refusesSignedOAuthQuery(res.error)) setConnectExpired(true);
      // r[impl hosting.magic-link.send-error]
      else if (res.error.status === 429) setLinkError("Too many sign-in links requested. Wait a moment and try again.");
      else setLinkError("We couldn't send a sign-in link. Try again.");
    } catch {
      setLinkError("We couldn't send a sign-in link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // S48 — verified sign-up: the account is created by the emailed link, so
  // Create account asks for no password; its first landing offers one.
  async function sendSignUpLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // S63 — a pending MCP connect rides in the link (`pendingAuthorizeURL`).
      const linkReturnTo = pendingAuthorizeURL() ?? returnTo;
      const res = await authClient.signIn.magicLink({
        email,
        name,
        callbackURL: linkReturnTo ?? "/",
        newUserCallbackURL: welcomeURL(linkReturnTo),
        errorCallbackURL: returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : "/",
      });
      if (!res.error) setSent({ kind: "sign-up", email });
      else if (refusesSignedOAuthQuery(res.error)) setConnectExpired(true);
      else if (res.error.status === 429) setError("Too many links requested. Wait a moment and try again.");
      else setError("We couldn't send a link. Try again.");
    } catch {
      setError("We couldn't send a link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // S48 — like a sign-in link, a reset request never says whether the address
  // has an account.
  async function sendReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    setBusy(true);
    try {
      const res = await authClient.requestPasswordReset({ email, redirectTo: RESET_REDIRECT });
      if (!res.error) setSent({ kind: "reset", email });
      else if (refusesSignedOAuthQuery(res.error)) setConnectExpired(true);
      else if (res.error.status === 429) setResetError("Too many reset links requested. Wait a moment and try again.");
      else setResetError("We couldn't send a reset link. Try again.");
    } catch {
      setResetError("We couldn't send a reset link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(newPassword: string) {
    setResetError(null);
    setBusy(true);
    try {
      const res = await authClient.resetPassword({ newPassword, token: resetLanding?.token ?? "" });
      if (!res.error) {
        setMode("sign-in");
        setNotice("Password updated — sign in with your new password");
        setView("main");
        onLandingDone?.();
      } else if (res.error.code === "INVALID_TOKEN") setView("reset-expired");
      else setResetError(passwordErrorMessage(res.error.code, "We couldn't reset your password. Try again."));
    } catch {
      setResetError("We couldn't reset your password. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function backToSignIn() {
    setSent(null);
    setResetError(null);
    setView("main");
    if (resetLanding) onLandingDone?.();
  }

  // S73 — on `/signin` or `/signup` the address follows the tab, so a copied URL
  // opens the same one; on any other path (a deep link to resume) it stays.
  function chooseMode(next: AuthMode) {
    setMode(next);
    if (authPath()) window.history.replaceState(window.history.state, "", authModePath(next) + window.location.search + window.location.hash);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = mode === "sign-up" ? await signUp.email({ name, email, password }) : await signIn.email({ email, password });
    setBusy(false);
    if (refusesSignedOAuthQuery(res.error)) setConnectExpired(true);
    else if (res.error) setError(res.error.message ?? "Authentication failed");
    // S63 — a pending MCP authorize request resumes server-side; the provider's
    // redirect (to the consent screen) is the next stop, not `returnTo`.
    else if (hasSignedOAuthQuery()) return;
    else if (returnTo) window.location.href = returnTo;
    else setPassword("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>

        <Card>
          {connectExpired ? (
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-center">
                <h1 className="text-lg font-semibold">This connection request has expired.</h1>
                <p className="text-sm text-muted-foreground">Start connecting again from Claude.</p>
              </div>
              {/* A full load of the bare root: the request's query goes with it. */}
              <Button variant="link" onClick={() => window.location.assign("/")}>
                Sign in without connecting
              </Button>
            </CardContent>
          ) : sent ? (
            <CardContent>
              <EmailSentPanel kind={sent.kind} email={sent.email} onBack={backToSignIn} />
            </CardContent>
          ) : !configLoaded && view !== "main" ? null : shown === "forgot" ? (
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-center">
                <h1 className="text-lg font-semibold">Reset your password</h1>
                <p className="text-sm text-muted-foreground">We'll email you a link to choose a new one.</p>
              </div>
              <form onSubmit={sendReset} className="flex flex-col gap-3">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  placeholder="Email"
                  aria-label="Email"
                  required
                />
                <Button type="submit" disabled={busy}>
                  Send reset link
                </Button>
                {resetError && <FieldError>{resetError}</FieldError>}
              </form>
              <Button variant="link" onClick={backToSignIn}>
                Back to sign in
              </Button>
            </CardContent>
          ) : shown === "reset" ? (
            <CardContent className="flex flex-col gap-4">
              <h1 className="text-center text-lg font-semibold">Choose a new password</h1>
              <NewPasswordForm submitLabel="Reset password" busy={busy} error={resetError} onSubmit={resetPassword} />
              <Button variant="link" onClick={backToSignIn}>
                Back to sign in
              </Button>
            </CardContent>
          ) : shown === "reset-expired" ? (
            <CardContent className="flex flex-col gap-4">
              <FieldError>That reset link has expired or was already used</FieldError>
              <Button onClick={() => setView("forgot")}>Send a new link</Button>
              <Button variant="link" onClick={backToSignIn}>
                Back to sign in
              </Button>
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-4">
              {/* S38 — each method renders only when the server says it is enabled. */}
              {configLoaded && cfg.googleEnabled && (
                <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
                  <GoogleMark />
                  Continue with Google
                </Button>
              )}

              {error && <FieldError>{error}</FieldError>}
              {notice && <p className="text-center text-sm text-muted-foreground">{notice}</p>}

              {configLoaded && cfg.emailPasswordEnabled && (
                <>
                  {/* The divider only separates two methods. */}
                  {cfg.googleEnabled && (
                    <div className="flex items-center gap-2.5">
                      <Separator className="flex-1" />
                      <span className="text-xs text-muted-foreground">or continue with email</span>
                      <Separator className="flex-1" />
                    </div>
                  )}

                  {/* With sign-up closed there is only one thing to do here, so the
                      tabs collapse to a plain sign-in form. */}
                  {tabsShown && (
                    <Tabs value={mode} onValueChange={(v) => chooseMode(v as AuthMode)}>
                      <TabsList className="w-full">
                        <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                        <TabsTrigger value="sign-up">Create account</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  )}

                  <form onSubmit={linkSignUp ? sendSignUpLink : submit} className="flex flex-col gap-3">
                    {mode === "sign-up" && (
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" required />
                    )}
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="Email"
                      aria-label="Email"
                      required
                    />
                    {!linkSignUp && (
                      <Input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        type="password"
                        placeholder="Password"
                        aria-label="Password"
                        required
                      />
                    )}
                    {/* S48 — offered only where a superset sends reset mail. */}
                    {/* r[impl identity.auth-screen.forgot-password] */}
                    {passwordReset && mode === "sign-in" && (
                      <Button type="button" variant="link" size="sm" className="self-end" onClick={() => setView("forgot")}>
                        Forgot password?
                      </Button>
                    )}
                    <Button type="submit" disabled={busy} className="mt-0.5">
                      {linkSignUp ? "Email me a link to create my account" : mode === "sign-up" ? "Create account" : "Sign in"}
                    </Button>
                  </form>
                </>
              )}

              {/* S33a — offered only where a superset registers magic-link sign-in. */}
              {/* With verified sign-up, Create account already emails a link. */}
              {configLoaded && magicLinkSignIn && !linkSignUp && (
                <>
                  {(cfg.googleEnabled || cfg.emailPasswordEnabled) && (
                    <div className="flex items-center gap-2.5">
                      <Separator className="flex-1" />
                      <span className="text-xs text-muted-foreground">or get a sign-in link</span>
                      <Separator className="flex-1" />
                    </div>
                  )}
                  <form onSubmit={sendLink} className="flex flex-col gap-3">
                    <Input
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      type="email"
                      placeholder="Email"
                      aria-label="Email for a sign-in link"
                      required
                    />
                    <Button type="submit" variant="outline" disabled={busy}>
                      Email me a sign-in link
                    </Button>
                    {linkError && <FieldError>{linkError}</FieldError>}
                  </form>
                </>
              )}

              {/* S67 — the sign-in and sign-up views only; the other views return above. */}
              {configLoaded && <LegalNotice legal={cfg.legal} />}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
