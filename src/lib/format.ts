/**
 * Re-indents JSON by walking its tokens instead of parsing it, so number
 * literals too large for a JS number (64-bit ids, long decimals) come out
 * exactly as the server sent them. Returns null when the text is not JSON.
 */
export function prettyJson(text: string, indent = "  "): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  const newline = () => `\n${indent.repeat(depth)}`;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "{" || ch === "[") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j]!)) j++;
      const close = ch === "{" ? "}" : "]";
      if (text[j] === close) {
        out += ch + close;
        i = j;
      } else {
        depth++;
        out += ch + newline();
      }
    } else if (ch === "}" || ch === "]") {
      depth--;
      out += newline() + ch;
    } else if (ch === ",") {
      out += ch + newline();
    } else if (ch === ":") {
      out += ": ";
    } else if (!/\s/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export type ContentKind = "json" | "xml" | "html" | "javascript" | "image" | "text" | "binary";

export function contentKind(contentType: string | undefined, isText: boolean): ContentKind {
  const type = (contentType ?? "").toLowerCase().split(";")[0]!.trim();
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (!isText) return "binary";
  if (type.includes("json")) return "json";
  if (type.includes("html")) return "html";
  if (type.includes("xml")) return "xml";
  if (type.includes("javascript")) return "javascript";
  return "text";
}

export function headerValue(headers: [string, string][], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

export interface ResponseCookie {
  name: string;
  value: string;
  attributes: Record<string, string>;
}

/** Reads the `Set-Cookie` headers of a response. */
export function parseSetCookies(headers: [string, string][]): ResponseCookie[] {
  const cookies: ResponseCookie[] = [];
  for (const [key, raw] of headers) {
    if (key.toLowerCase() !== "set-cookie") continue;
    const [first, ...rest] = raw.split(";");
    const eq = first!.indexOf("=");
    if (eq < 0) continue;
    const attributes: Record<string, string> = {};
    for (const part of rest) {
      const at = part.indexOf("=");
      const name = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
      if (name) attributes[name] = at < 0 ? "true" : part.slice(at + 1).trim();
    }
    cookies.push({ name: first!.slice(0, eq).trim(), value: first!.slice(eq + 1).trim(), attributes });
  }
  return cookies;
}

export function statusClass(status: number): "ok" | "redirect" | "client" | "server" | "info" {
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  if (status >= 300) return "redirect";
  if (status >= 200) return "ok";
  return "info";
}
