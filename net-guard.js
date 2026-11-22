// 公网地址校验与 DNS 固定（pin）工具：Webhook、AI 模型、翻译 API 共用，防 SSRF 与 DNS rebinding。
// 出站请求必须先经 validatedAddresses 校验目标主机只解析到公网 IP，再用 makePinnedLookup 固定解析结果。
import net from 'node:net';
import { lookup } from 'node:dns/promises';

const ipv4BlockedRanges = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([address, bits]) => [ipv4ToNumber(address), bits]);

function ipv4ToNumber(address) {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}
function inIPv4Range(address, network, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((address & mask) >>> 0) === ((network & mask) >>> 0);
}
export function isPublicAddress(address) {
  const ip = String(address).replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) {
    const number = ipv4ToNumber(ip);
    return !ipv4BlockedRanges.some(([network, bits]) => inIPv4Range(number, network, bits));
  }
  if (family !== 6) return false;
  if (ip.startsWith('::ffff:')) {
    const suffix = ip.slice(7);
    if (net.isIPv4(suffix)) return isPublicAddress(suffix);
    const groups = suffix.split(':');
    if (groups.length === 2 && groups.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
      const n = ((parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16)) >>> 0;
      return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return false;
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && !ip.startsWith('2001:db8:') && !ip.startsWith('2002:');
}
export function makePinnedLookup(addresses) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const family = Number(options?.family || 0);
    const matches = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!matches.length) {
      const error = new Error('No validated address for the requested address family.');
      error.code = 'ENOTFOUND';
      callback(error);
      return;
    }
    if (options?.all) callback(null, matches);
    else callback(null, matches[0].address, matches[0].family);
  };
}
export async function validatedAddresses(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(host);
  const entries = family ? [{ address: host, family }] : await lookup(host, { all: true, verbatim: true });
  if (!entries.length || entries.some((entry) => !isPublicAddress(entry.address))) {
    throw new Error('Host must resolve only to public IP addresses.');
  }
  return entries;
}
