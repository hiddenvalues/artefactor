import { useEffect, useState } from "react";
import { authClient } from "$lib/auth";
import { Logo } from "$lib/components/Logo";
import { Button } from "$lib/components/ui/button";
import { Card, CardContent } from "$lib/components/ui/card";

// S63 — the MCP connector's consent screen (`/oauth/consent`). The OAuth
// provider sends a signed-in user's authorize request here with a signed query
// (`…&sig=`); `oauthProviderClient()` adds that query to every auth POST this
// page makes, so each call names the request it answers. Allow or Deny posts to
// `/oauth2/consent` and follows the redirect back to the client: with a code, or
// with `error=access_denied`. Design: docs/design/templates/auth-flow.md *Consent*.

const GRANT =
  "It will be able to create, read, update, share and archive your artefacts, and read and write their saved data, as you.";

// Where the code goes: the host of the one `redirect_uri` the provider signed
// (`ba_param` names the signed keys). The name is whatever the client chose
// for itself; the host is what the person can check. The provider verifies the
// signature over these values before the screen shows Allow.
function signedReturnHost(params: URLSearchParams): string | null {
  const uris = params.getAll("redirect_uri");
  if (uris.length !== 1 || !params.getAll("ba_param").includes("redirect_uri")) return null;
  try {
    return new URL(uris[0]!).host || null;
  } catch {
    return null;
  }
}

export type ConsentState =
  | { kind: "loading" }
  | { kind: "ready"; clientName: string; returnHost: string }
  | { kind: "expired" };

export function OAuthConsentScreen({ email }: { email: string }) {
  const [state, setState] = useState<ConsentState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  // The provider verifies the signed query before it names the client, so an
  // expired, missing or tampered request never reaches Allow.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("client_id");
    const returnHost = signedReturnHost(params);
    if (!clientId || !params.has("sig") || !returnHost) {
      setState({ kind: "expired" });
      return;
    }
    authClient
      .$fetch<{ client_id: string; client_name?: string }>("/oauth2/public-client-prelogin", {
        method: "POST",
        body: { client_id: clientId },
      })
      .then(({ data, error }) => {
        if (error || !data) setState({ kind: "expired" });
        else setState({ kind: "ready", clientName: data.client_name || data.client_id, returnHost });
      })
      .catch(() => setState({ kind: "expired" }));
  }, []);

  async function answer(accept: boolean) {
    setBusy(true);
    try {
      const { data, error } = await authClient.$fetch<{ url?: string; redirect_uri?: string; redirect?: boolean }>(
        "/oauth2/consent",
        { method: "POST", body: { accept } },
      );
      const to = data?.url ?? data?.redirect_uri;
      if (error || !to) {
        setState({ kind: "expired" });
        setBusy(false);
        return;
      }
      // Leaving the app: the client takes it from here. A `{ redirect: true, url }`
      // answer is already followed by the auth client's own redirect plugin, so
      // navigating again would send the single-use code to the client twice.
      if (!data?.redirect) window.location.assign(to);
    } catch {
      setState({ kind: "expired" });
      setBusy(false);
    }
  }

  return (
    <OAuthConsentView state={state} email={email} busy={busy} onAllow={() => answer(true)} onDeny={() => answer(false)} />
  );
}

// S71 — the page, rendered from its state alone, so the catalog can preview
// every state without a signed request in the address. Go to Home stays here:
// it is a navigation, not a provider call.
// r[impl platform.design.consent-preview-states]
export function OAuthConsentView({
  state,
  email,
  busy,
  onAllow,
  onDeny,
}: {
  state: ConsentState;
  email: string;
  busy: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        <Card>
          {state.kind === "loading" ? (
            <CardContent className="text-center text-sm text-muted-foreground">Loading…</CardContent>
          ) : state.kind === "expired" ? (
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-center">
                <h1 className="text-lg font-semibold">This connection request has expired.</h1>
                <p className="text-sm text-muted-foreground">Start connecting again from Claude.</p>
              </div>
              <Button variant="link" onClick={() => window.location.assign("/")}>
                Go to Home
              </Button>
            </CardContent>
          ) : (
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-center">
                <h1 className="text-lg font-semibold">Connect {state.clientName} to Artefactor?</h1>
                <p className="text-sm text-muted-foreground">
                  {state.clientName} will act as <span className="font-medium text-foreground">{email}</span>.
                </p>
                <p className="text-sm text-muted-foreground">
                  It will send you back to <span className="font-medium text-foreground">{state.returnHost}</span>.
                </p>
              </div>
              <p className="text-sm">{GRANT}</p>
              <div className="flex flex-col gap-2">
                <Button disabled={busy} onClick={onAllow}>
                  Allow
                </Button>
                <Button variant="outline" disabled={busy} onClick={onDeny}>
                  Deny
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
