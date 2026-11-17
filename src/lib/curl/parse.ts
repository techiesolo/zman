import { emptyRequest, formPart, kv } from "../../model/factory";
import type { RequestDef } from "../../model/types";
import { parseQuery, setUrlQuery, splitUrl, syncPathVars } from "../url";

export class CurlParseError extends Error {}

export interface CurlImport {
  request: RequestDef;
  warnings: string[];
}

const ANSI_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

/** Splits a command line the way a POSIX shell would, without expanding anything. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;

    if (ch === "\\") {
      const next = input[i + 1];
      if (next === "\n") i += 2;
      else if (next === "\r" && input[i + 2] === "\n") i += 3;
      else if (next === undefined) i++;
      else {
        current += next;
        started = true;
        i += 2;
      }
      continue;
    }
    // cmd.exe line continuation, as produced by "Copy as cURL (cmd)".
    if (ch === "^" && (input[i + 1] === "\n" || input[i + 1] === "\r")) {
      i += input[i + 1] === "\r" ? 3 : 2;
      continue;
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) throw new CurlParseError("Unterminated single quote in the cURL command.");
      current += input.slice(i + 1, end);
      started = true;
      i = end + 1;
      continue;
    }
    if (ch === "$" && input[i + 1] === "'") {
      i += 2;
      let closed = false;
      while (i < n) {
        const c = input[i]!;
        if (c === "'") {
          closed = true;
          i++;
          break;
        }
        if (c === "\\" && i + 1 < n) {
          const e = input[i + 1]!;
          if (e === "x" || e === "u") {
            const width = e === "x" ? 2 : 4;
            const hex = input.slice(i + 2, i + 2 + width);
            if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === width) {
              current += String.fromCharCode(Number.parseInt(hex, 16));
              i += 2 + width;
              continue;
            }
          }
          current += ANSI_ESCAPES[e] ?? `\\${e}`;
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new CurlParseError("Unterminated $'...' string in the cURL command.");
      started = true;
      continue;
    }
    if (ch === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const c = input[i]!;
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "\\" && i + 1 < n) {
          const e = input[i + 1]!;
          if (e === "\n") {
            i += 2;
            continue;
          }
          if (e === '"' || e === "\\" || e === "$" || e === "`") {
            current += e;
            i += 2;
            continue;
          }
        }
        current += c;
        i++;
      }
      if (!closed) throw new CurlParseError("Unterminated double quote in the cURL command.");
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      i++;
      continue;
    }
    current += ch;
    started = true;
    i++;
  }
  if (started) tokens.push(current);
  return tokens;
}

/** Options that take a value. Value is the canonical long name. */
const VALUE_OPTIONS: Record<string, string> = {
  "-X": "request",
  "--request": "request",
  "-H": "header",
  "--header": "header",
  "-d": "data",
  "--data": "data",
  "--data-ascii": "data",
  "--data-raw": "data-raw",
  "--data-binary": "data-binary",
  "--data-urlencode": "data-urlencode",
  "--json": "json",
  "-F": "form",
  "--form": "form",
  "--form-string": "form-string",
  "-u": "user",
  "--user": "user",
  "-A": "user-agent",
  "--user-agent": "user-agent",
  "-e": "referer",
  "--referer": "referer",
  "-b": "cookie",
  "--cookie": "cookie",
  "--url": "url",
  "--oauth2-bearer": "bearer",
  "-T": "upload-file",
  "--upload-file": "upload-file",
};

/** Options that take a value zman has no use for. */
const IGNORED_VALUE_OPTIONS = new Set([
  "-o", "--output", "-m", "--max-time", "--connect-timeout", "-x", "--proxy", "-U", "--proxy-user",
  "--cacert", "--capath", "-E", "--cert", "--key", "--cert-type", "--key-type", "--pass", "-w", "--write-out",
  "--retry", "--retry-delay", "--retry-max-time", "-c", "--cookie-jar", "--resolve", "--connect-to",
  "-D", "--dump-header", "--max-redirs", "--interface", "--limit-rate", "-K", "--config", "--ciphers",
  "--tls-max", "--noproxy", "-Y", "--speed-limit", "-y", "--speed-time", "-z", "--time-cond", "-r", "--range",
  "--stderr", "--trace", "--trace-ascii", "--unix-socket", "--aws-sigv4", "-C", "--continue-at",
]);

const SHORT_VALUE_FLAGS = new Set("XHdFuAebTomxUEwcDKYyzrC".split(""));

function decodeFormComponent(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function looksLikeFormPairs(data: string): boolean {
  const trimmed = data.trim();
  if (trimmed === "" || /^[[{<"]/.test(trimmed) || /[\n{}]/.test(trimmed)) return false;
  return trimmed.split("&").every((pair) => /^[^=&\s]+=[^&]*$/.test(pair));
}

/** Converts a `curl ...` command line into a request. */
export function parseCurl(command: string): CurlImport {
  const tokens = tokenize(command.trim().replace(/^\$\s+/, ""));
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0]!)) {
    throw new CurlParseError('A cURL command has to start with "curl".');
  }

  const warnings: string[] = [];
  const request = emptyRequest();
  let url: string | null = null;
  let method: string | null = null;
  let head = false;
  let asQuery = false;
  const data: string[] = [];
  let binaryFile: string | null = null;
  const ignored = new Set<string>();

  const apply = (name: string, value: string) => {
    switch (name) {
      case "request":
        method = value.toUpperCase();
        break;
      case "header": {
        const colon = value.indexOf(":");
        if (colon > 0) request.headers.push(kv(value.slice(0, colon).trim(), value.slice(colon + 1).trim()));
        else if (value.endsWith(";")) request.headers.push(kv(value.slice(0, -1).trim(), ""));
        break;
      }
      case "data":
      case "data-binary":
        if (value.startsWith("@")) binaryFile = value.slice(1);
        else data.push(value);
        break;
      case "data-raw":
        data.push(value);
        break;
      case "data-urlencode": {
        const eq = value.indexOf("=");
        if (eq < 0) data.push(encodeURIComponent(value));
        else if (eq === 0) data.push(encodeURIComponent(value.slice(1)));
        else data.push(`${value.slice(0, eq)}=${encodeURIComponent(value.slice(eq + 1))}`);
        break;
      }
      case "json":
        data.push(value);
        request.headers.push(kv("Content-Type", "application/json"), kv("Accept", "application/json"));
        break;
      case "form":
      case "form-string": {
        const eq = value.indexOf("=");
        if (eq < 0) break;
        const key = value.slice(0, eq);
        let content = value.slice(eq + 1);
        if (name === "form" && (content.startsWith("@") || content.startsWith("<"))) {
          const path = content.slice(1).split(";")[0]!.replace(/^"(.*)"$/, "$1");
          request.body.formdata.push(formPart(key, path, "file"));
        } else {
          if (name === "form") content = content.replace(/;type=[^;]*$/, "");
          request.body.formdata.push(formPart(key, content, "text"));
        }
        break;
      }
      case "user": {
        const colon = value.indexOf(":");
        request.auth = {
          type: "basic",
          username: colon < 0 ? value : value.slice(0, colon),
          password: colon < 0 ? "" : value.slice(colon + 1),
        };
        break;
      }
      case "bearer":
        request.auth = { type: "bearer", token: value };
        break;
      case "user-agent":
        request.headers.push(kv("User-Agent", value));
        break;
      case "referer":
        request.headers.push(kv("Referer", value));
        break;
      case "cookie":
        // Without "=", curl treats the argument as a cookie file name.
        if (value.includes("=")) request.headers.push(kv("Cookie", value));
        break;
      case "url":
        url = value;
        break;
      case "upload-file":
        binaryFile = value;
        method ??= "PUT";
        break;
    }
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    const takeValue = (flag: string): string => {
      const value = tokens[++i];
      if (value === undefined) throw new CurlParseError(`Option ${flag} needs a value.`);
      return value;
    };

    if (token.startsWith("--")) {
      const name = VALUE_OPTIONS[token];
      if (name) apply(name, takeValue(token));
      else if (IGNORED_VALUE_OPTIONS.has(token)) {
        takeValue(token);
        ignored.add(token);
      } else if (token === "--get") asQuery = true;
      else if (token === "--head") head = true;
      else if (!["--location", "--insecure", "--compressed", "--silent", "--show-error", "--verbose", "--include", "--fail", "--globoff", "--http1.1", "--http2", "--no-buffer"].includes(token)) {
        ignored.add(token);
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      // Short options can be bundled (-sSL) and can carry their value (-XPOST).
      for (let j = 1; j < token.length; j++) {
        const flag = `-${token[j]}`;
        if (SHORT_VALUE_FLAGS.has(token[j]!)) {
          const attached = token.slice(j + 1);
          const value = attached !== "" ? attached : takeValue(flag);
          const name = VALUE_OPTIONS[flag];
          if (name) apply(name, value);
          else ignored.add(flag);
          break;
        }
        if (flag === "-G") asQuery = true;
        else if (flag === "-I") head = true;
      }
      continue;
    }

    if (url === null) url = token;
    else warnings.push(`Extra argument "${token}" was ignored.`);
  }

  if (url === null) throw new CurlParseError("The cURL command has no URL.");
  url = url as string;

  if (asQuery && data.length > 0) {
    const { query } = splitUrl(url);
    const pairs = [...(query ? parseQuery(query) : []), ...parseQuery(data.join("&"))];
    url = setUrlQuery(url, pairs.map((p) => kv(p.key, p.value)));
    data.length = 0;
  }

  const contentType =
    request.headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? null;

  if (request.body.formdata.length > 0) {
    request.body.mode = "formdata";
  } else if (binaryFile !== null) {
    request.body.mode = "binary";
    request.body.binaryPath = binaryFile;
    warnings.push(`The body is read from the file "${binaryFile}". Check that the path exists on this computer.`);
  } else if (data.length > 0) {
    const joined = data.join("&");
    const formLike = contentType ? contentType.includes("x-www-form-urlencoded") : looksLikeFormPairs(joined);
    if (formLike) {
      request.body.mode = "urlencoded";
      request.body.urlencoded = parseQuery(joined).map((p) =>
        kv(decodeFormComponent(p.key), decodeFormComponent(p.value)),
      );
    } else {
      request.body.mode = "raw";
      request.body.raw = joined;
      if (contentType?.includes("json")) request.body.rawLanguage = "json";
      else if (contentType?.includes("xml")) request.body.rawLanguage = "xml";
      else if (contentType?.includes("html")) request.body.rawLanguage = "html";
      else if (contentType) request.body.rawLanguage = "text";
      else {
        // curl sends -d as a form unless told otherwise; keep that on the wire.
        request.headers.push(kv("Content-Type", "application/x-www-form-urlencoded"));
        request.body.rawLanguage = /^\s*[[{]/.test(joined) ? "json" : "text";
      }
    }
  }

  const hasBody = request.body.mode !== "none";
  request.method = method ?? (head ? "HEAD" : hasBody ? "POST" : "GET");
  request.url = url;
  const { query } = splitUrl(url);
  request.params = query === null ? [] : parseQuery(query).map((p) => kv(p.key, p.value));
  request.pathVars = syncPathVars(url, []);

  if (ignored.size > 0) warnings.push(`Ignored options: ${[...ignored].sort().join(", ")}.`);
  return { request, warnings };
}

/** True when pasted text is worth handing to `parseCurl`. */
export function looksLikeCurl(text: string): boolean {
  return /^\s*(\$\s+)?curl(\.exe)?\s/i.test(text);
}
