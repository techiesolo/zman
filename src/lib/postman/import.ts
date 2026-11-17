import { emptyBody, formPart, kv, newId } from "../../model/factory";
import type {
  Auth,
  Body,
  Collection,
  Environment,
  FolderItem,
  Item,
  KV,
  PostmanPassthrough,
  RawLanguage,
  RequestDef,
  RequestItem,
} from "../../model/types";
import { parseQuery, splitUrl, syncPathVars } from "../url";

export class ImportError extends Error {}

export interface CollectionImport {
  kind: "collection";
  collection: Collection;
  stats: { requests: number; folders: number };
  warnings: string[];
}

export interface EnvironmentImport {
  kind: "environment";
  scope: "environment" | "globals";
  environment: Environment;
  warnings: string[];
}

export type ImportResult = CollectionImport | EnvironmentImport;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Postman stores most scalars as strings but numbers and booleans do show up. */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function description(value: unknown): string | undefined {
  const text = isObj(value) ? str(value.content) : str(value);
  return text === "" ? undefined : text;
}

function kvRow(raw: unknown): KV | null {
  if (!isObj(raw)) return null;
  return kv(str(raw.key ?? raw.id), str(raw.value), raw.disabled !== true, description(raw.description));
}

function kvRows(raw: unknown): KV[] {
  return arr(raw)
    .map(kvRow)
    .filter((row): row is KV => row !== null);
}

/** Detects the file type and converts it. Throws `ImportError` with a message fit for the user. */
export function importPostmanJson(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("This is not valid JSON.");
  }
  if (!isObj(data)) throw new ImportError("This file is not a Postman collection or environment.");

  if (isObj(data.info) && Array.isArray(data.item)) return importCollection(data);
  if (Array.isArray(data.values) && !("item" in data)) return importEnvironment(data);

  if (Array.isArray(data.requests) && Array.isArray(data.order)) {
    throw new ImportError(
      "This is a Postman Collection v1 file. Export it from Postman again as Collection v2.1.",
    );
  }
  if (Array.isArray(data.collections) && Array.isArray(data.environments)) {
    throw new ImportError(
      "This is a full Postman data dump. Export the collections one by one as Collection v2.1 instead.",
    );
  }
  if ("openapi" in data || "swagger" in data) {
    throw new ImportError("OpenAPI files are not supported. Import a Postman Collection v2.1 file.");
  }
  throw new ImportError("This file is not a Postman collection or environment.");
}

function importEnvironment(data: Obj): EnvironmentImport {
  const scope = data._postman_variable_scope === "globals" ? "globals" : "environment";
  const variables = arr(data.values)
    .filter(isObj)
    .map((v) => kv(str(v.key), str(v.value), v.enabled !== false));
  return {
    kind: "environment",
    scope,
    environment: { id: newId(), name: str(data.name) || (scope === "globals" ? "Globals" : "Imported Environment"), variables },
    warnings: [],
  };
}

interface Tally {
  requests: number;
  folders: number;
  scripted: number;
  examples: number;
  unsupportedAuth: Set<string>;
  fileRefs: number;
}

function importCollection(data: Obj): CollectionImport {
  const info = data.info as Obj;
  const tally: Tally = {
    requests: 0,
    folders: 0,
    scripted: 0,
    examples: 0,
    unsupportedAuth: new Set(),
    fileRefs: 0,
  };

  const rootAuth = convertAuth(data.auth, tally);
  const collection: Collection = {
    id: newId(),
    name: str(info.name) || "Imported Collection",
    auth: rootAuth.type === "inherit" ? { type: "none" } : rootAuth,
    variables: kvRows(data.variable),
    items: convertItems(data.item, tally),
  };
  const desc = description(info.description);
  if (desc) collection.description = desc;
  const passthrough = passthroughOf(data, tally);
  if (passthrough) collection.postman = passthrough;

  const warnings: string[] = [];
  if (tally.scripted > 0) {
    warnings.push(
      `${plural(tally.scripted, "item has", "items have")} pre-request or test scripts. zman does not run scripts; they are kept and written back on export.`,
    );
  }
  if (tally.unsupportedAuth.size > 0) {
    warnings.push(
      `Authorization type ${[...tally.unsupportedAuth].sort().join(", ")} is not supported. Affected requests are sent without it.`,
    );
  }
  if (tally.fileRefs > 0) {
    warnings.push(
      `${plural(tally.fileRefs, "request body refers", "request bodies refer")} to files on disk. Check that the paths exist on this computer.`,
    );
  }
  if (tally.examples > 0) {
    warnings.push(
      `${plural(tally.examples, "saved example response is", "saved example responses are")} kept for export but not shown.`,
    );
  }

  return { kind: "collection", collection, stats: { requests: tally.requests, folders: tally.folders }, warnings };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function hasScript(event: unknown): boolean {
  return arr(event).some((e) => {
    if (!isObj(e) || !isObj(e.script)) return false;
    const exec = e.script.exec;
    const source = Array.isArray(exec) ? exec.join("\n") : str(exec);
    return source.trim() !== "";
  });
}

function passthroughOf(raw: Obj, tally: Tally): PostmanPassthrough | undefined {
  const out: PostmanPassthrough = {};
  if (Array.isArray(raw.event) && raw.event.length > 0) {
    out.event = raw.event;
    if (hasScript(raw.event)) tally.scripted++;
  }
  if (Array.isArray(raw.response) && raw.response.length > 0) {
    out.response = raw.response;
    tally.examples += raw.response.length;
  }
  if (isObj(raw.protocolProfileBehavior)) out.protocolProfileBehavior = raw.protocolProfileBehavior;
  return Object.keys(out).length > 0 ? out : undefined;
}

function convertItems(raw: unknown, tally: Tally): Item[] {
  const items: Item[] = [];
  for (const entry of arr(raw)) {
    if (!isObj(entry)) continue;
    // A folder is an item that has `item`; everything else is a request.
    if (Array.isArray(entry.item)) {
      tally.folders++;
      const folder: FolderItem = {
        type: "folder",
        id: newId(),
        name: str(entry.name) || "Folder",
        auth: convertAuth(entry.auth, tally),
        items: convertItems(entry.item, tally),
      };
      const desc = description(entry.description);
      if (desc) folder.description = desc;
      const passthrough = passthroughOf(entry, tally);
      if (passthrough) folder.postman = passthrough;
      items.push(folder);
    } else if (entry.request !== undefined) {
      tally.requests++;
      const { request, desc } = convertRequest(entry.request, tally);
      const item: RequestItem = {
        type: "request",
        id: newId(),
        name: str(entry.name) || request.url || "Request",
        request,
      };
      const text = desc ?? description(entry.description);
      if (text) item.description = text;
      const passthrough = passthroughOf(entry, tally);
      if (passthrough) item.postman = passthrough;
      items.push(item);
    }
  }
  return items;
}

function convertRequest(raw: unknown, tally: Tally): { request: RequestDef; desc?: string } {
  // The schema allows a bare URL string in place of a request object.
  if (typeof raw === "string") raw = { url: raw };
  const r = isObj(raw) ? raw : {};

  const { url, params, pathVars } = convertUrl(r.url);
  const headers = typeof r.header === "string" ? headerLines(r.header) : kvRows(r.header);
  const request: RequestDef = {
    method: (str(r.method) || "GET").toUpperCase(),
    url,
    params,
    pathVars,
    headers,
    body: convertBody(r.body, headers, tally),
    auth: convertAuth(r.auth, tally),
  };
  const desc = description(r.description);
  return desc ? { request, desc } : { request };
}

function headerLines(text: string): KV[] {
  const rows: KV[] = [];
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) rows.push(kv(line.slice(0, colon).trim(), line.slice(colon + 1).trim()));
  }
  return rows;
}

function convertUrl(raw: unknown): Pick<RequestDef, "url" | "params" | "pathVars"> {
  if (typeof raw === "string") {
    return { url: raw, params: paramsFromUrl(raw), pathVars: syncPathVars(raw, []) };
  }
  if (!isObj(raw)) return { url: "", params: [], pathVars: [] };

  const url = typeof raw.raw === "string" && raw.raw !== "" ? raw.raw : assembleUrl(raw);
  const params = Array.isArray(raw.query) ? kvRows(raw.query) : paramsFromUrl(url);
  const pathVars = syncPathVars(url, kvRows(raw.variable));
  return { url, params, pathVars };
}

function paramsFromUrl(url: string): KV[] {
  const { query } = splitUrl(url);
  return query === null ? [] : parseQuery(query).map((p) => kv(p.key, p.value));
}

/** Rebuilds a URL from its parts when a file has no `raw` field. */
function assembleUrl(u: Obj): string {
  const join = (value: unknown, sep: string) => (Array.isArray(value) ? value.map(str).join(sep) : str(value));
  let url = "";
  const protocol = str(u.protocol);
  if (protocol) url += `${protocol}://`;
  url += join(u.host, ".");
  const port = str(u.port);
  if (port) url += `:${port}`;
  const path = join(u.path, "/");
  if (path) url += path.startsWith("/") ? path : `/${path}`;
  const query = arr(u.query)
    .filter(isObj)
    .filter((q) => q.disabled !== true)
    .map((q) => `${str(q.key)}=${str(q.value)}`);
  if (query.length) url += `?${query.join("&")}`;
  const hash = str(u.hash);
  if (hash) url += `#${hash}`;
  return url;
}

const RAW_LANGUAGES: RawLanguage[] = ["json", "text", "xml", "html", "javascript"];

function languageFromHeaders(headers: KV[]): RawLanguage {
  const contentType = headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("xml")) return "xml";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("javascript")) return "javascript";
  return "text";
}

function convertBody(raw: unknown, headers: KV[], tally: Tally): Body {
  const body = emptyBody();
  if (!isObj(raw) || raw.disabled === true) return body;

  switch (raw.mode) {
    case "raw": {
      body.mode = "raw";
      body.raw = str(raw.raw);
      const options = isObj(raw.options) && isObj(raw.options.raw) ? raw.options.raw : {};
      const language = str(options.language) as RawLanguage;
      body.rawLanguage = RAW_LANGUAGES.includes(language) ? language : languageFromHeaders(headers);
      break;
    }
    case "urlencoded":
      body.mode = "urlencoded";
      body.urlencoded = kvRows(raw.urlencoded);
      break;
    case "formdata": {
      body.mode = "formdata";
      let files = 0;
      body.formdata = arr(raw.formdata)
        .filter(isObj)
        .map((part) => {
          const enabled = part.disabled !== true;
          if (part.type === "file") {
            files++;
            // Postman allows several files per field; zman sends the first.
            const src = Array.isArray(part.src) ? str(part.src[0]) : str(part.src);
            return formPart(str(part.key), src, "file", enabled);
          }
          return formPart(str(part.key), str(part.value), "text", enabled);
        });
      if (files > 0) tally.fileRefs++;
      break;
    }
    case "file":
      body.mode = "binary";
      body.binaryPath = isObj(raw.file) ? str(raw.file.src) : "";
      tally.fileRefs++;
      break;
    case "graphql": {
      body.mode = "graphql";
      const gql = isObj(raw.graphql) ? raw.graphql : {};
      body.graphqlQuery = str(gql.query);
      body.graphqlVariables = str(gql.variables);
      break;
    }
    default:
      break;
  }
  return body;
}

/**
 * Auth attributes are an array of `{key, value}` in v2.1 and a plain object
 * in v2.0. Both are flattened into one lookup.
 */
function authAttributes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) if (isObj(entry)) out[str(entry.key)] = str(entry.value);
  } else if (isObj(raw)) {
    for (const [key, value] of Object.entries(raw)) out[key] = str(value);
  }
  return out;
}

function convertAuth(raw: unknown, tally: Tally): Auth {
  if (!isObj(raw)) return { type: "inherit" };
  const type = str(raw.type);
  const attrs = authAttributes(raw[type]);
  switch (type) {
    case "":
      return { type: "inherit" };
    case "noauth":
      return { type: "none" };
    case "basic":
      return { type: "basic", username: attrs.username ?? "", password: attrs.password ?? "" };
    case "bearer":
      return { type: "bearer", token: attrs.token ?? "" };
    case "apikey":
      return {
        type: "apikey",
        key: attrs.key ?? "",
        value: attrs.value ?? "",
        in: attrs.in === "query" ? "query" : "header",
      };
    default:
      tally.unsupportedAuth.add(type);
      return { type: "unsupported", postmanType: type, raw };
  }
}
