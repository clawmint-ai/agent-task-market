// Pure config parsers. NO imports (esp. no db/pool) so this is safe to import
// from unit tests without triggering DATABASE_URL-required module side effects.

/**
 * Reverse-proxy trust policy. In production the API sits behind Caddy
 * (Caddyfile), so without this Fastify reads req.ip as the proxy's container IP
 * — collapsing every IP-keyed rate-limit bucket into one and stamping every
 * signup_ip identically (which trips the same-IP self-dealing heuristic and
 * freezes all earned rewards). TRUST_PROXY is the number of proxy hops to trust:
 *   0 / unset → trust nothing (req.ip is the socket peer; correct with no proxy)
 *   N (>=1)   → trust the last N hops; req.ip is taken from X-Forwarded-For.
 * A non-numeric value is passed through to proxy-addr verbatim (IP/CIDR list),
 * for deployments that prefer to pin the trusted hop by address.
 */
export function trustProxy(): boolean | number | string {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return false;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n === 0 ? false : n;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw; // proxy-addr accepts an IP / CIDR / comma list
}
