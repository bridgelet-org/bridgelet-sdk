import { isIP } from 'node:net';

export type Femaleotaku1014ValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

function isPrivateOrLocalIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata (incl. 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrLocalIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isPrivateOrLocalIpv4(mapped);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateOrLocalIpv4(ip);
  if (kind === 6) return isPrivateOrLocalIpv6(ip);
  return false;
}

/**
 * Standalone helper for issue #1014: reject webhook URLs targeting SSRF-prone
 * destinations (localhost, link-local, cloud metadata IPs, private ranges).
 * Intended for use by DTO validators or delivery guards without wiring changes.
 */
export function femaleotaku1014ValidateWebhookUrl(input: string): Femaleotaku1014ValidationResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { ok: false, reason: 'blocked_hostname' };
  }

  if (isIP(hostname) && isBlockedIp(hostname)) {
    return { ok: false, reason: 'blocked_ip_range' };
  }

  // Bracketed IPv6 hostnames come through URL.hostname without brackets in some runtimes; be defensive.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(bare) && isBlockedIp(bare)) {
    return { ok: false, reason: 'blocked_ip_range' };
  }

  return { ok: true, normalized: url.toString() };
}
