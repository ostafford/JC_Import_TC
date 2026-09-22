import type { IncomingMessage } from "node:http";

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export async function parseFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw.toString("utf8"));
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}
