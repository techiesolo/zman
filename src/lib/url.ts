import { kv } from "../model/factory";
import type { KV } from "../model/types";

interface UrlParts {
  base: string;
  query: string | null;
  hash: string;
}

/** Splits a raw (possibly templated) URL without decoding or validating it. */
export function splitUrl(raw: string): UrlParts {
  let rest = raw;
  let hash = "";
  const hashAt = rest.indexOf("#");
  if (hashAt >= 0) {
    hash = rest.slice(hashAt);
    rest = rest.slice(0, hashAt);
  }
  const queryAt = rest.indexOf("?");
  if (queryAt < 0) return { base: rest, query: null, hash };
  return { base: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash };
}

export function parseQuery(query: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const pair of query.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq < 0) out.push({ key: pair, value: "" });
    else out.push({ key: pair.slice(0, eq), value: pair.slice(eq + 1) });
  }
  return out;
}

/**
 * Rebuilds the params table after the URL was edited. Enabled rows are
 * replaced, in order, by what the query string now says; disabled rows stay
 * where they are because they have no representation in the URL.
 */
export function syncParamsFromUrl(url: string, prev: KV[]): KV[] {
  const { query } = splitUrl(url);
  const parsed = query === null ? [] : parseQuery(query);
  const out: KV[] = [];
  let next = 0;
  for (const row of prev) {
    if (!row.enabled) {
      out.push(row);
      continue;
    }
    const p = parsed[next];
    if (!p) continue;
    next++;
    out.push(row.key === p.key && row.value === p.value ? row : { ...row, key: p.key, value: p.value });
  }
  for (; next < parsed.length; next++) {
    const p = parsed[next]!;
    out.push(kv(p.key, p.value));
  }
  return out;
}

/** Rewrites the query string of `url` from the enabled rows of the params table. */
export function setUrlQuery(url: string, params: KV[]): string {
  const { base, hash } = splitUrl(url);
  const pairs = params.filter((p) => p.enabled && (p.key !== "" || p.value !== "")).map((p) => `${p.key}=${p.value}`);
  return base + (pairs.length ? `?${pairs.join("&")}` : "") + hash;
}

const PATH_VAR = /\/:([A-Za-z_][A-Za-z0-9_-]*)(?=\/|$)/g;

export function pathVarNames(url: string): string[] {
  const { base } = splitUrl(url);
  const names: string[] = [];
  for (const m of base.matchAll(PATH_VAR)) {
    const name = m[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function syncPathVars(url: string, prev: KV[]): KV[] {
  const names = pathVarNames(url);
  if (names.length === prev.length && names.every((n, i) => prev[i]!.key === n)) return prev;
  return names.map((name) => prev.find((p) => p.key === name) ?? kv(name, ""));
}

/** Replaces `/:name` segments with their (already resolved) values. */
export function applyPathVars(url: string, values: Record<string, string>): string {
  const { base, query, hash } = splitUrl(url);
  const replaced = base.replace(PATH_VAR, (whole, name: string) =>
    name in values ? `/${encodeURIComponent(values[name]!)}` : whole,
  );
  return replaced + (query === null ? "" : `?${query}`) + hash;
}

/**
 * Turns a fully substituted URL string into what goes on the wire: adds a
 * scheme when missing and percent-encodes characters that are not legal in a
 * URL, leaving existing escapes alone. Throws on an unusable URL.
 */
export function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (url === "") throw new Error("The URL is empty.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${raw.trim()}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol "${parsed.protocol.replace(":", "")}". Only http and https are supported.`);
  }
  return parsed.href;
}

export function appendQueryParam(url: string, key: string, value: string): string {
  const { base, query, hash } = splitUrl(url);
  const pair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return `${base}?${query ? `${query}&` : ""}${pair}${hash}`;
}
