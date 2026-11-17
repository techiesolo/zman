import type { Body, Collection, Environment, FolderItem, FormPart, KV, RequestDef, RequestItem } from "./types";

export function newId(): string {
  return crypto.randomUUID();
}

export function kv(key = "", value = "", enabled = true, description?: string): KV {
  const row: KV = { id: newId(), key, value, enabled };
  if (description) row.description = description;
  return row;
}

export function formPart(key = "", value = "", type: FormPart["type"] = "text", enabled = true): FormPart {
  return { ...kv(key, value, enabled), type };
}

export function emptyBody(): Body {
  return {
    mode: "none",
    raw: "",
    rawLanguage: "json",
    urlencoded: [],
    formdata: [],
    binaryPath: "",
    graphqlQuery: "",
    graphqlVariables: "",
  };
}

export function emptyRequest(): RequestDef {
  return {
    method: "GET",
    url: "",
    params: [],
    pathVars: [],
    headers: [],
    body: emptyBody(),
    auth: { type: "inherit" },
  };
}

export function newRequestItem(name = "New Request", request: RequestDef = emptyRequest()): RequestItem {
  return { type: "request", id: newId(), name, request };
}

export function newFolder(name = "New Folder"): FolderItem {
  return { type: "folder", id: newId(), name, auth: { type: "inherit" }, items: [] };
}

export function newCollection(name = "New Collection"): Collection {
  return { id: newId(), name, auth: { type: "none" }, variables: [], items: [] };
}

export function newEnvironment(name = "New Environment"): Environment {
  return { id: newId(), name, variables: [] };
}
