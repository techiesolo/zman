import type { HttpRequestSpec } from "../../model/types";
import { USER_AGENT } from "../buildRequest";

/** Quotes for a POSIX shell. */
export function shellQuote(text: string): string {
  if (/^[A-Za-z0-9_\-.,:/@%+=]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * Renders the request exactly as zman would send it. The headers zman adds
 * on its own are left out because curl supplies its own equivalents.
 */
export function generateCurl(spec: HttpRequestSpec): string {
  const lines: string[] = [];
  let first = "curl";
  if (spec.method === "HEAD") first += " -I";
  else if (spec.method !== "GET" || spec.body.kind !== "none") first += ` -X ${shellQuote(spec.method)}`;
  if (spec.options.followRedirects) first += " -L";
  if (!spec.options.verifySsl) first += " -k";
  lines.push(`${first} ${shellQuote(spec.url)}`);

  for (const [name, value] of spec.headers) {
    const lower = name.toLowerCase();
    if (lower === "user-agent" && value === USER_AGENT) continue;
    if (lower === "accept" && value === "*/*") continue;
    lines.push(`-H ${shellQuote(value === "" ? `${name};` : `${name}: ${value}`)}`);
  }

  switch (spec.body.kind) {
    case "none":
      break;
    case "raw":
      lines.push(`--data-raw ${shellQuote(spec.body.text)}`);
      break;
    case "urlencoded":
      for (const [key, value] of spec.body.fields) lines.push(`--data-urlencode ${shellQuote(`${key}=${value}`)}`);
      break;
    case "formdata":
      for (const part of spec.body.parts) {
        if (part.kind === "file") lines.push(`-F ${shellQuote(`${part.name}=@"${part.path}"`)}`);
        else lines.push(`--form-string ${shellQuote(`${part.name}=${part.value}`)}`);
      }
      break;
    case "binary":
      lines.push(`--data-binary ${shellQuote(`@${spec.body.path}`)}`);
      break;
  }
  return lines.join(" \\\n  ");
}
