// The visitor's real IP, for rate limits and logs.
//
// Production traffic goes visitor -> Cloudflare -> reverse proxy (Caddy/Nginx) -> app. With
// TRUST_PROXY=1, Express's req.ip is the address that connected to the reverse proxy: a
// Cloudflare server, shared by many visitors. Cloudflare puts the visitor's address in the
// CF-Connecting-IP header, so we use that header, but ONLY when req.ip is one of Cloudflare's
// own addresses. Anyone connecting to the server directly (skipping Cloudflare) can send the
// header too, but then req.ip is their own address, so the header is ignored.
// Without Cloudflare in front (local development), this is plain req.ip.
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

// Published at https://www.cloudflare.com/ips/ (they rarely change; check it once a year).
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_IPV4) {
  const [net, bits] = range.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv4');
}
for (const range of CLOUDFLARE_IPV6) {
  const [net, bits] = range.split('/');
  cloudflare.addSubnet(net, Number(bits), 'ipv6');
}

/** "::ffff:1.2.3.4" (IPv4 seen through an IPv6 socket) -> "1.2.3.4". */
const unmapIpv4 = (ip: string) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

export function isCloudflareIp(ip: string): boolean {
  const addr = unmapIpv4(ip);
  const family = isIP(addr);
  return family === 4 ? cloudflare.check(addr, 'ipv4') : family === 6 ? cloudflare.check(addr, 'ipv6') : false;
}

export function clientIp(req: Pick<Request, 'ip' | 'headers' | 'socket'>): string {
  const peer = unmapIpv4(req.ip || req.socket?.remoteAddress || '');
  const header = req.headers['cf-connecting-ip'];
  const forwarded = typeof header === 'string' ? header.trim() : '';
  if (forwarded && isIP(forwarded) && isCloudflareIp(peer)) return unmapIpv4(forwarded);
  return peer;
}
