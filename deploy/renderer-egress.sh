#!/bin/sh
# S37 (AH29) — host firewall rules for the isolated thumbnail renderer.
#
# The renderer runs untrusted artefact HTML. Chromium's sandbox and the empty,
# read-only, one-job-per-container setup (deploy/docker-compose.example.yml) are
# the first layers; these rules are the network one. They say, for the renderer's
# two bridges:
#
#   * app → renderer:3001 is allowed, and only that direction (the link bridge
#     runs with icc=false, so nothing else between those containers passes);
#   * the renderer may open connections to the public internet (CDN CSS, fonts,
#     images) and to DNS, but to nothing private: RFC1918, CGNAT, loopback and
#     link-local — including the 169.254.169.254 cloud metadata endpoint — and
#     their IPv6 equivalents;
#   * replies to connections the app opened are untouched (conntrack).
#
# Run once as root on the Docker host, after `docker compose up -d` has created
# the networks (the rules match the bridge names, so they survive container
# restarts and IP changes). Re-running is safe: every rule is checked first.
#
#   sudo ./deploy/renderer-egress.sh
#
# DOCKER-USER survives a Docker restart but NOT a reboot. Re-run it from a boot
# unit (or persist the rules with iptables-persistent) — docs/renderer-isolation.md
# § Verify a deployment tells you how to confirm it is in force.
set -eu

LINK_IF="${LINK_IF:-br-art-link}"
EGRESS_IF="${EGRESS_IF:-br-art-egress}"
RENDERER_PORT="${RENDERER_PORT:-3001}"

PRIVATE_V4="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16"
PRIVATE_V6="fc00::/7 fe80::/10 ::1/128"

# Add a rule to a chain unless an identical one is already there.
ensure() {
  _cmd=$1
  _chain=$2
  shift 2
  if ! "$_cmd" -C "$_chain" "$@" 2>/dev/null; then
    "$_cmd" -I "$_chain" "$@"
  fi
}

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables not found. On a host using the nftables backend, translate these rules" >&2
  echo "by hand — see docs/renderer-isolation.md." >&2
  exit 1
fi

# --- the app → renderer link -------------------------------------------------
# Established traffic first (replies to whatever is allowed below), then the one
# allowed direction, and the renderer's own attempts to reach anything on this
# bridge are left to the bridge's icc=false DROP.
ensure iptables DOCKER-USER -i "$LINK_IF" -o "$LINK_IF" \
  -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
ensure iptables DOCKER-USER -i "$LINK_IF" -o "$LINK_IF" \
  -p tcp --dport "$RENDERER_PORT" -m conntrack --ctstate NEW -j ACCEPT

# --- the renderer's egress ---------------------------------------------------
# DNS is allowed even to a private resolver: Docker's embedded DNS forwards the
# renderer's lookups to the host's resolvers, which are often on a private
# address, and without them no CDN name resolves.
for proto in udp tcp; do
  ensure iptables DOCKER-USER -i "$EGRESS_IF" -p "$proto" --dport 53 -j ACCEPT
done

# Nothing private, in either chain: DOCKER-USER covers traffic routed *through*
# the host (other containers, the LAN, the metadata service), INPUT covers the
# host itself (the bridge gateway, the host's own listening ports).
for net in $PRIVATE_V4; do
  ensure iptables DOCKER-USER -i "$EGRESS_IF" -d "$net" -m conntrack --ctstate NEW -j DROP
done
ensure iptables INPUT -i "$EGRESS_IF" -m conntrack --ctstate NEW -j DROP
ensure iptables INPUT -i "$LINK_IF" -m conntrack --ctstate NEW -j DROP

# --- IPv6, where the host has it ---------------------------------------------
if command -v ip6tables >/dev/null 2>&1 && ip6tables -L DOCKER-USER >/dev/null 2>&1; then
  for net in $PRIVATE_V6; do
    ensure ip6tables DOCKER-USER -i "$EGRESS_IF" -d "$net" -m conntrack --ctstate NEW -j DROP
  done
  ensure ip6tables INPUT -i "$EGRESS_IF" -m conntrack --ctstate NEW -j DROP
  ensure ip6tables INPUT -i "$LINK_IF" -m conntrack --ctstate NEW -j DROP
fi

echo "renderer egress rules in force for $LINK_IF (app → :$RENDERER_PORT only) and $EGRESS_IF (public internet only)."
