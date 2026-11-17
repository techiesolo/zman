import type { HttpError, HttpRequestSpec, HttpResponseData, ResponseBody } from "../model/types";
import type { Backend, PickedFile, StoreKind } from "./index";

/**
 * Stands in for the desktop backend when the UI is opened in a browser
 * (`npm run dev`). Documents go to localStorage and requests go through
 * `fetch`, so they are subject to CORS and cannot upload files.
 */

const PREFIX = "zman:";
const key = (kind: StoreKind, id: string) => `${PREFIX}${kind}/${id}`;

const controllers = new Map<string, AbortController>();

function fail(kind: HttpError["kind"], message: string): HttpError {
  return { kind, message };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function send(id: string, spec: HttpRequestSpec): Promise<HttpResponseData> {
  let body: BodyInit | undefined;
  switch (spec.body.kind) {
    case "none":
      break;
    case "raw":
      body = spec.body.text;
      break;
    case "urlencoded":
      body = new URLSearchParams(spec.body.fields).toString();
      break;
    case "formdata": {
      const form = new FormData();
      for (const part of spec.body.parts) {
        if (part.kind === "file") throw fail("file", "File uploads only work in the desktop app.");
        form.append(part.name, part.value);
      }
      body = form;
      break;
    }
    case "binary":
      throw fail("file", "File uploads only work in the desktop app.");
  }

  const controller = new AbortController();
  controllers.set(id, controller);
  let timedOut = false;
  const timer =
    spec.options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, spec.options.timeoutMs)
      : undefined;
  const started = performance.now();
  try {
    const response = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.method === "GET" || spec.method === "HEAD" ? undefined : body,
      redirect: spec.options.followRedirects ? "follow" : "manual",
      signal: controller.signal,
      credentials: "omit",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let responseBody: ResponseBody;
    try {
      responseBody = { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      responseBody = { kind: "base64", data: toBase64(bytes) };
    }
    return {
      status: response.status,
      statusText: response.statusText,
      httpVersion: "HTTP",
      headers: [...response.headers.entries()],
      body: responseBody,
      sizeBytes: bytes.length,
      timeMs: Math.round(performance.now() - started),
      finalUrl: response.url || spec.url,
    };
  } catch (error) {
    if (timedOut) throw fail("timeout", "The request timed out.");
    if (controller.signal.aborted) throw fail("cancelled", "Request cancelled");
    throw fail("connect", `Could not connect: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    controllers.delete(id);
  }
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFiles(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (file) => ({ name: file.name, contents: await file.text() }))));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export const mockBackend: Backend = {
  native: false,
  send,
  cancel: async (id) => controllers.get(id)?.abort(),
  clearCookies: async () => undefined,
  storeList: async (kind) => {
    const prefix = `${PREFIX}${kind}/`;
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(prefix)) ids.push(name.slice(prefix.length));
    }
    return ids.sort();
  },
  storeRead: async (kind, id) => localStorage.getItem(key(kind, id)),
  storeWrite: async (kind, id, contents) => localStorage.setItem(key(kind, id), contents),
  storeDelete: async (kind, id) => localStorage.removeItem(key(kind, id)),
  pickImportFiles: pickFiles,
  pickFilePath: async () => window.prompt("Path of the file to send (used by the desktop app only):"),
  saveTextFile: async (defaultName, contents) => {
    download(defaultName, contents, "application/json");
    return defaultName;
  },
  saveResponseBody: async (defaultName, body) => {
    download(defaultName, body.kind === "text" ? body.text : fromBase64(body.data), "application/octet-stream");
    return defaultName;
  },
  appInfo: async () => ({ version: "dev", dataDir: "localStorage (browser preview)" }),
  onClose: (flush) => {
    window.addEventListener("pagehide", () => void flush());
  },
};
