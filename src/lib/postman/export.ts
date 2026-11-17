import type { Auth, Body, Collection, Environment, Item, KV, RequestDef } from "../../model/types";
import { splitUrl } from "../url";

export const POSTMAN_SCHEMA_V21 = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type Obj = Record<string, unknown>;

/** Builds a Postman Collection v2.1 document. */
export function exportCollection(collection: Collection): Obj {
  const out: Obj = {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      ...(collection.description ? { description: collection.description } : {}),
      schema: POSTMAN_SCHEMA_V21,
    },
    item: collection.items.map(exportItem),
  };
  const auth = exportAuth(collection.auth);
  if (auth && collection.auth.type !== "none") out.auth = auth;
  if (collection.postman?.event) out.event = collection.postman.event;
  if (collection.variables.length > 0) {
    out.variable = collection.variables.map((v) => ({
      key: v.key,
      value: v.value,
      ...(v.enabled ? {} : { disabled: true }),
    }));
  }
  return out;
}

function exportItem(item: Item): Obj {
  if (item.type === "folder") {
    const out: Obj = { name: item.name, item: item.items.map(exportItem) };
    if (item.description) out.description = item.description;
    const auth = exportAuth(item.auth);
    if (auth) out.auth = auth;
    if (item.postman?.event) out.event = item.postman.event;
    return out;
  }
  const out: Obj = { name: item.name };
  if (item.postman?.event) out.event = item.postman.event;
  if (item.postman?.protocolProfileBehavior) out.protocolProfileBehavior = item.postman.protocolProfileBehavior;
  out.request = exportRequest(item.request, item.description);
  out.response = item.postman?.response ?? [];
  return out;
}

function exportRequest(request: RequestDef, description?: string): Obj {
  const out: Obj = { method: request.method };
  const auth = exportAuth(request.auth);
  if (auth) out.auth = auth;
  out.header = request.headers.map((h) => exportRow(h, { type: "text" }));
  const body = exportBody(request.body);
  if (body) out.body = body;
  out.url = exportUrl(request);
  if (description) out.description = description;
  return out;
}

function exportRow(row: KV, extra: Obj = {}): Obj {
  return {
    key: row.key,
    value: row.value,
    ...extra,
    ...(row.description ? { description: row.description } : {}),
    ...(row.enabled ? {} : { disabled: true }),
  };
}

/** Splits on `sep` but never inside a `{{variable}}`, whose name may contain it. */
function splitOutsideVariables(text: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{{", i)) {
      depth++;
      current += "{{";
      i++;
    } else if (text.startsWith("}}", i) && depth > 0) {
      depth--;
      current += "}}";
      i++;
    } else if (text[i] === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += text[i];
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Postman reads the URL from its parts rather than from `raw`, so the parts
 * have to be filled in for the URL to show up after import.
 */
export function exportUrl(request: Pick<RequestDef, "url" | "params" | "pathVars">): Obj {
  const { base, hash } = splitUrl(request.url);
  const out: Obj = { raw: request.url };

  let rest = base;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest);
  if (scheme) {
    out.protocol = scheme[1];
    rest = rest.slice(scheme[0].length);
  }
  const slash = rest.indexOf("/");
  let authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash + 1);

  const port = /:(\d+|\{\{[^{}]+\}\})$/.exec(authority);
  if (port) {
    out.port = port[1];
    authority = authority.slice(0, port.index);
  }
  out.host = authority === "" ? [] : splitOutsideVariables(authority, ".");
  if (slash >= 0) out.path = splitOutsideVariables(path, "/");

  if (request.params.length > 0) out.query = request.params.map((p) => exportRow(p));
  if (hash) out.hash = hash.slice(1);
  if (request.pathVars.length > 0) {
    out.variable = request.pathVars.map((v) => ({
      key: v.key,
      value: v.value,
      ...(v.description ? { description: v.description } : {}),
    }));
  }
  return out;
}

function exportBody(body: Body): Obj | null {
  switch (body.mode) {
    case "none":
      return null;
    case "raw":
      return { mode: "raw", raw: body.raw, options: { raw: { language: body.rawLanguage } } };
    case "urlencoded":
      return { mode: "urlencoded", urlencoded: body.urlencoded.map((f) => exportRow(f, { type: "text" })) };
    case "formdata":
      return {
        mode: "formdata",
        formdata: body.formdata.map((part) => {
          if (part.type === "file") {
            return {
              key: part.key,
              type: "file",
              src: part.value,
              ...(part.description ? { description: part.description } : {}),
              ...(part.enabled ? {} : { disabled: true }),
            };
          }
          return exportRow(part, { type: "text" });
        }),
      };
    case "binary":
      return { mode: "file", file: { src: body.binaryPath } };
    case "graphql":
      return { mode: "graphql", graphql: { query: body.graphqlQuery, variables: body.graphqlVariables } };
  }
}

function attrs(values: Record<string, string>): Obj[] {
  return Object.entries(values).map(([key, value]) => ({ key, value, type: "string" }));
}

/** Returns null for `inherit`, which Postman expresses by leaving `auth` out. */
function exportAuth(auth: Auth): Obj | null {
  switch (auth.type) {
    case "inherit":
      return null;
    case "none":
      return { type: "noauth" };
    case "basic":
      return { type: "basic", basic: attrs({ username: auth.username, password: auth.password }) };
    case "bearer":
      return { type: "bearer", bearer: attrs({ token: auth.token }) };
    case "apikey":
      return { type: "apikey", apikey: attrs({ key: auth.key, value: auth.value, in: auth.in }) };
    case "unsupported":
      return auth.raw as Obj;
  }
}

/** Builds a Postman environment (or globals) file. */
export function exportEnvironment(environment: Environment, scope: "environment" | "globals" = "environment"): Obj {
  return {
    id: environment.id,
    name: environment.name,
    values: environment.variables.map((v) => ({ key: v.key, value: v.value, type: "default", enabled: v.enabled })),
    _postman_variable_scope: scope,
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: "zman",
  };
}

export function toJson(doc: unknown): string {
  return `${JSON.stringify(doc, null, "\t")}\n`;
}

/** A file name that is safe on macOS and Linux. */
export function safeFileName(name: string, suffix: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "untitled";
  return `${cleaned}${suffix}`;
}
