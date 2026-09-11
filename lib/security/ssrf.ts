import { isIP } from "net";
import { lookup } from "dns/promises";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(ip: string): boolean {
  if (ip === "::1") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^169\.254\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

export async function assertSafeHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https allowed");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local")) {
    throw new Error("Blocked host");
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error("Private IP blocked");
  }
  if (!isIP(host)) {
    const records = await lookup(host, { all: true });
    if (records.some((r) => isPrivateIp(r.address))) {
      throw new Error("Resolved private IP blocked");
    }
  }
  return url;
}
