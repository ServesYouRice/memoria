import { BlockList, isIP } from "net";

function normalizeIp(value: string): string | null {
  let address = value.trim();
  if (address.startsWith("[") && address.includes("]")) {
    address = address.slice(1, address.indexOf("]"));
  }
  address = address.split("%")[0] || address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) address = mapped[1];
  return isIP(address) ? address : null;
}

function createTrustedProxyList(cidrs: string): BlockList {
  const list = new BlockList();
  for (const rawCidr of cidrs.split(",")) {
    const cidr = rawCidr.trim();
    if (!cidr) continue;
    const [rawAddress, rawPrefix] = cidr.split("/");
    const address = rawAddress ? normalizeIp(rawAddress) : null;
    if (!address) throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
    const family = isIP(address) === 4 ? "ipv4" : "ipv6";
    const maxPrefix = family === "ipv4" ? 32 : 128;
    const prefix = rawPrefix === undefined ? maxPrefix : Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
    }
    list.addSubnet(address, prefix, family);
  }
  return list;
}

export function deriveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyCidrs: string | undefined,
): string {
  const peer = socketAddress ? normalizeIp(socketAddress) : null;
  if (!peer) return "unknown";
  if (!trustedProxyCidrs?.trim()) return peer;

  const trusted = createTrustedProxyList(trustedProxyCidrs);
  const isTrusted = (address: string) =>
    trusted.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  if (!isTrusted(peer)) return peer;

  const rawHeader = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : forwardedFor || "";
  const chain = rawHeader.split(",").map(normalizeIp);
  if (chain.some((address) => !address)) return peer;

  let client = peer;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!isTrusted(client)) return client;
    client = chain[index] as string;
  }
  return client;
}
