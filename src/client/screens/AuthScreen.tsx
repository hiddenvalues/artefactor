import { useEffect, useState, type FormEvent } from "react";
import type { PublicConfigResponse } from "../../shared/contracts";
import { api } from "$lib/api";
import { authClient, signIn, signUp } from "$lib/auth";
import { Logo } from "$lib/components/Logo";
import { FieldError } from "$lib/components/UploadDialog";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent } from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Separator } from "$lib/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "$lib/components/ui/tabs";

// If the config call fails, show both methods with sign-up open — the server
// rejects whatever isn't configured, so failing this way never hides a method
// that works.
const FALLBACK: PublicConfigResponse = {
  allowedEmailDomains: [],
  emailPasswordEnabled: true,
  googleEnabled: true,
  signupAllowed: true,
};

// A gated artefact link (e.g. a "Members" artefact opened by someone without an
// account) redirects here as `/?returnTo=/a/<slug>`. Capture it before the
// auth_error cleanup strips the query, and honour only same-origin internal
// paths (guard against open redirects). After a successful sign-in we send the
// user back there so they land on the artefact they came for.
function readReturnTo(): string | null {
  const raw = new URLSearchParams(window.location.search).get("returnTo");
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

// A failed Google sign-in (e.g. an account outside the allowed email domains,
// blocked by the server-side allowlist) bounces back here via errorCallbackURL.
// Surface the real reason BetterAuth reports rather than assuming the cause.
function readAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const detail = params.get("error_description") || params.get("error");
  if (!params.has("auth_error") && !detail) return null;
  return detail
    ? `Google sign-in failed: ${decodeURIComponent(detail).replace(/[_+]/g, " ")}`
    : "Google sign-in failed. Make sure you're using an authorized account.";
}

function GoogleMark() {
  // Google's brand mark keeps its own colours: an image, not UI colour.
  return <img src="/google-g.svg" alt="" className="size-4" />;
}

export function AuthScreen() {
  // S38 — which methods this deployment accepts is *server* configuration, read
  // from GET /api/config on mount. Enforcement stays server-side; these flags
  // only decide what is worth rendering. Until the call settles, render no
  // method rather than flashing one the server would reject.
  const [config, setConfig] = useState<PublicConfigResponse | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const cfg = config ?? FALLBACK;
  const [returnTo] = useState(readReturnTo);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(readAuthError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (readAuthError()) window.history.replaceState({}, "", window.location.pathname);
    api
      .config()
      .then(setConfig)
      .catch(() => {
        /* leave null → FALLBACK (both methods, sign-up open) */
      })
      .finally(() => setConfigLoaded(true));
  }, []);

  // Allowed sign-in domains, read from the server (AUTH_ALLOWED_EMAIL_DOMAINS)
  // so the hint reflects the real config without hardcoding domains here.
  const domainsHint = cfg.allowedEmailDomains.length
    ? cfg.allowedEmailDomains.map((d) => `@${d}`).join(" or ")
    : null;

  async function google() {
    setError(null);
    setBusy(true);
    try {
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: returnTo ?? "/",
        errorCallbackURL: returnTo ? `/?auth_error=1&returnTo=${encodeURIComponent(returnTo)}` : "/?auth_error=1",
      });
      if (res.error) setError(res.error.message ?? "Google sign-in failed.");
    } catch {
      setError("Google sign-in failed. Check your connection and try again.");
    } finally {
      // On success the browser is already on its way to Google; this only
      // matters when the redirect didn't start.
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = mode === "sign-up" ? await signUp.email({ name, email, password }) : await signIn.email({ email, password });
    setBusy(false);
    if (res.error) setError(res.error.message ?? "Authentication failed");
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
          <CardContent className="flex flex-col gap-4">
            {/* S38 — each method renders only when the server says it is enabled. */}
            {configLoaded && cfg.googleEnabled && (
              <div>
                <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
                  <GoogleMark />
                  Continue with Google
                </Button>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">
                  {domainsHint ? (
                    <>
                      Use your <strong>{domainsHint}</strong> Google account.
                    </>
                  ) : (
                    "Use your organization Google account."
                  )}
                </p>
              </div>
            )}

            {error && <FieldError>{error}</FieldError>}

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
                {cfg.signupAllowed && (
                  <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                    <TabsList className="w-full">
                      <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                      <TabsTrigger value="sign-up">Create account</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}

                <form onSubmit={submit} className="flex flex-col gap-3">
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
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    placeholder="Password"
                    aria-label="Password"
                    required
                  />
                  <Button type="submit" disabled={busy} className="mt-0.5">
                    {mode === "sign-up" ? "Create account" : "Sign in"}
                  </Button>
                </form>

                {/* The allowlist (IA4) gates email+password sign-up too; with
                    Google off, this is the only place left to say so. */}
                {!cfg.googleEnabled && mode === "sign-up" && domainsHint && (
                  <p className="text-center text-xs text-muted-foreground">
                    Sign-up is open to <strong>{domainsHint}</strong> addresses.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
