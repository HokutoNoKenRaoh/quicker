// The network a client address belongs to, for a limit per network: an IPv4 address is its own network; an IPv6
// address counts as its /64, the block one subscriber line gets (any address in it can be picked freely); an
// IPv4-mapped IPv6 address ("::ffff:1.2.3.4") counts as that IPv4 address. Anything else ("unknown", a value that
// doesn't parse) is returned as it is, lower-cased. Pure, never throws.

const HEX_GROUP = /^[0-9a-f]{1,4}$/;
const DOTTED_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function networkKey(ip: string): string {
  const s = ip.trim().toLowerCase();
  if (!s.includes(":")) return s;
  const groups = ipv6Groups(s.split("%")[0]!); // a zone ("fe80::1%eth0") is not part of the network
  if (!groups) return s;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The 8 groups of an IPv6 address as numbers (a dotted IPv4 ending as the last two), or null when it doesn't parse. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parts = (text: string | undefined) => (text ? text.split(":") : []);
  let head = parts(halves[0]);
  let tail = halves.length === 2 ? parts(halves[1]) : [];
  // Only the very end of the address may be a dotted IPv4 ("::ffff:1.2.3.4", "64:ff9b::1.2.3.4").
  const end = halves.length === 2 ? tail : head;
  const v4 = end.length ? DOTTED_IPV4.exec(end[end.length - 1]!) : null;
  if (v4) {
    const b = v4.slice(1, 5).map(Number);
    if (b.some((n) => n > 255)) return null;
    const pair = [((b[0]! << 8) | b[1]!).toString(16), ((b[2]! << 8) | b[3]!).toString(16)];
    if (halves.length === 2) tail = [...tail.slice(0, -1), ...pair];
    else head = [...head.slice(0, -1), ...pair];
  }
  if (![...head, ...tail].every((g) => HEX_GROUP.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  return [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
}
