/**
 * Lightweight non-crypto IP hashing for rate limiting + vote dedup.
 *
 * We don't store raw IPs (privacy), just a stable bucket per IP.
 * For real production-grade fingerprinting, use sha256. For our purposes
 * (anti-spam on votes, basic rate limiting), this is sufficient and fast.
 */
export function hashIp(ip: string): string {
    let h = 0;
    for (let i = 0; i < ip.length; i++) {
      h = (h * 31 + ip.charCodeAt(i)) >>> 0;
    }
    return `ip_${h.toString(16)}`;
  }
  
  export function getIpFromRequest(request: Request): string {
    return (
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown"
    );
  }