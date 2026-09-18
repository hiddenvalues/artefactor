# Renderer isolation — running untrusted artefact HTML safely

Artefactor draws a card thumbnail by **screenshotting the artefact** (S35). To draw it,
Chromium runs the uploader's JavaScript. This document is why that is not done in the app's
container, what protects it instead, and how to check a deployment.

The domain rule is **AH29** in [`specs/ddd/artefact-hosting.md`](specs/ddd/artefact-hosting.md);
the slice is **S37 — Isolated thumbnail renderer**. The configuration that implements it is
[`../deploy/docker-compose.example.yml`](../deploy/docker-compose.example.yml) and
[`../deploy/renderer-egress.sh`](../deploy/renderer-egress.sh).

## Threat model

An artefact is **trusted HTML** by product decision: it is served as-is, never sanitised. That
decision is about *serving* — the browser that runs it is the viewer's own, and the artefact is
same-origin only with itself. Rendering is different: **the server runs the HTML**, on our
machine, next to everything else we have.

So the question is not "is this artefact malicious?" but "what does a successful exploit get?"

- **Scanning the HTML was rejected.** An exploit is ordinary JavaScript: obfuscated, assembled
  at runtime, or fetched after load. A zero-day in Chromium matches no signature. Meanwhile
  legitimate artefacts — the whole point of the product — do exactly what a scanner would flag:
  generate code, draw on canvases, fetch from CDNs. A scanner would be bypassed by the attacker
  and would block honest users.
- **Sandboxing is not a guarantee either.** Chromium's renderer sandbox is strong, and
  sandbox-escape chains exist. The design assumes a full escape *inside the renderer container*
  is possible, and makes it **worthless**: there is nothing in that container to steal, no way
  back to the app, and nothing that survives the job.

What an escape would reach in the S35 shape (a browser in the app's container): every artefact
payload and thumbnail under `/data`, the SQLite database, `BETTER_AUTH_SECRET` (forge any
session), `GOOGLE_CLIENT_SECRET`, the internal network, and the HTML of every artefact rendered
afterwards. That is why S35 shipped with rendering off.

## The four layers

Each layer assumes the ones before it may fail.

| Layer | What it stops |
| --- | --- |
| **1. Chromium's OS sandbox is on** | The page's JavaScript is confined to a renderer process in its own user, pid and network namespace, under seccomp-bpf. Breaking out needs a kernel or broker bug, not just a V8 bug. The renderer **never** falls back to an unsandboxed launch: if the sandbox cannot start, it reports itself unavailable and the app keeps showing placeholders. |
| **2. The container is empty** | An escape lands in a container with no secrets, no database, no `/data`, a **read-only** root filesystem, no capabilities (`cap_drop: ALL`, `no-new-privileges`), an unprivileged user, and only tmpfs to write to. The renderer's own startup self-check refuses to run in production if a secret, a database URL, or an app storage directory is visible, or if it is running as root. |
| **3. One job per container** | The process answers exactly one render and exits; the restart policy brings back a fresh container with an empty tmpfs. Anything an artefact leaves behind — a foothold in the browser, a file in `/tmp`, a resident process — is gone before the next artefact is rendered, so one artefact can never see another's HTML. |
| **4. It cannot reach anything worth reaching** | Host firewall rules let the renderer talk to the public internet (so CDN CSS, fonts and images still load) and to DNS, and drop new connections to every private and link-local range — including `169.254.169.254`, the cloud metadata service. The app can reach the renderer; the renderer cannot reach the app. |

Inside the page, S35's measures still hold: a synthetic `https://artefact.invalid/` origin (so
Chromium's Local Network Access check refuses loopback and private addresses even where layer 4
is not applied), blocked WebSockets and service workers, no credentials or storage, a fresh
context, and a 15 s cap. Payloads above **10 MB** are never rendered at all.

## Host prerequisites

Chromium's unprivileged sandbox needs to create a user namespace and `chroot` inside it. Two
host settings can stand in the way:

1. **seccomp.** Docker's default profile allows `clone` with namespace flags, `unshare` and
   `chroot` only to a container holding `CAP_SYS_ADMIN` / `CAP_SYS_CHROOT` — which the renderer
   deliberately does not have. Ship the profile instead:
   `security_opt: [seccomp=./chromium-seccomp.json]`. It is Docker's own default profile plus a
   single rule allowing those three calls. **Never** use `seccomp=unconfined`, `--privileged` or
   `--cap-add SYS_ADMIN`: those give away more than the sandbox is worth.
2. **AppArmor (Ubuntu 23.10+).** `kernel.apparmor_restrict_unprivileged_userns=1` can stop
   unprivileged user namespaces. Containers run under the `docker-default` profile, which in
   the current Ubuntu policy is not subject to the restriction — but this is exactly the kind of
   thing a distro changes. If the renderer reports a launch failure, check:

   ```bash
   sysctl kernel.apparmor_restrict_unprivileged_userns
   ```

   The fixes, best first: an AppArmor profile for the browser binary
   ([Chromium's guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)),
   or — on a host dedicated to this — `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
   That sysctl relaxes a host-wide hardening measure, so prefer the profile on a shared box.

`/dev/shm` needs no attention: Chromium is launched with `--disable-dev-shm-usage`.

Docker's `DOCKER-USER` chain (which the egress script writes to) exists on the **iptables**
firewall backend. On a host running Docker's nftables backend, translate the rules by hand into
an equivalent nftables chain and verify with the checks below.

## Verify a deployment

After `docker compose up -d` **and** `sudo ./deploy/renderer-egress.sh`:

```bash
# 1. No secrets, and no /data.
docker compose exec renderer env | grep -Ei 'secret|token|password|database' ; echo "exit=$?"   # expect no matches
docker compose exec renderer ls /data                                                           # expect: No such file or directory

# 2. The root filesystem is read-only, and the process is not root.
docker compose exec renderer sh -c 'touch /nope' # expect: Read-only file system
docker compose exec renderer id -u               # expect: 1000

# 3. The sandbox really is on (the renderer refuses to run without it).
curl -fsS http://localhost:3000/health >/dev/null && docker compose logs renderer | tail -3
#    expect: "sandboxed Chromium launched — ready"

# 4. It can reach the public internet, but nothing private.
#    (-k: the runtime image ships no CA bundle, so curl cannot verify TLS. Chromium
#     brings its own root store, so CDN assets load normally in a render.)
docker compose exec renderer sh -c 'curl -sk -m 5 -o /dev/null -w "cdn:%{http_code}\n" https://cdnjs.cloudflare.com/'  # expect 200
docker compose exec renderer sh -c 'curl -s -m 5 http://app:3000/health; echo "app exit=$?"'                           # expect non-zero
docker compose exec renderer sh -c 'curl -s -m 5 http://169.254.169.254/; echo "metadata exit=$?"'                     # expect non-zero
```

Note that `docker compose exec` into the renderer is a debugging convenience; it is not a path
the artefact has.

Then upload an artefact and watch one job's whole life:

```bash
docker events --filter container=artefactor-renderer-1 --filter event=die --filter event=start
```

A render should be followed by `die` and a `start` about 100 ms later — a new container, with a
new tmpfs, for the next artefact.

### Cycle time

Measured on Docker Desktop 29.4 (Apple silicon), image `node:26-bookworm-slim` with
`chromium-headless-shell`:

| Step | Time |
| --- | --- |
| Container start → `/health` ready (Node boot + the sandboxed probe launch) | ~3.2 s |
| One render (launch, load, settle, capture, close), a small fixture | ~1.2 s |
| Minimum uptime before exit (`ARTEFACTOR_RENDERER_MIN_UPTIME_MS`) | 10 s |
| Exit → next container running (Docker's restart delay) | ~0.1 s |

The 10 s floor costs the *waiting artefact*, never the upload: the render is answered in about a
second, and the container then exits on its own. In a **burst** it means roughly one artefact
every ~11–14 s (render, wait out the minimum uptime, exit, restart, become ready). Docker resets
its restart backoff only for a container that ran at least 10 s; exiting sooner makes the delay
double each time (0.1 s → 0.2 s → 0.4 s → … → 12.8 s), which is far worse. Raising throughput is
a separate change (replicas, or a longer-lived renderer that gives up layer 3), not a tuning knob.

While a renderer is draining or restarting, the app's request is refused or answered `503`; it
retries for a minute (AH25), so a queued render simply waits for the next container.

## If you do not run the renderer

Leave `ARTEFACTOR_RENDERER_URL` unset. The app logs one line at startup, never renders, and every
card shows its kind placeholder (AH25). Nothing else changes. That is also what happens if the
renderer is down: the app retries for a minute, then pauses thumbnail work for five minutes and
tries again — the artefacts themselves are untouched.

**Do not** point `ARTEFACTOR_RENDERER_URL` at a renderer that is not isolated as described here.
An easier setup — the app's own container, no sandbox — is exactly what this slice removed.
