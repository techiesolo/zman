import type { HttpRequestSpec, HttpResponseData, ResponseBody } from "../model/types";
import { mockBackend } from "./mock";
import { tauriBackend } from "./tauri";

export type StoreKind = "collections" | "environments" | "app";

export interface PickedFile {
  name: string;
  contents: string;
}

/**
 * Everything the UI needs from outside the webview. The app talks to this
 * interface only, so it runs unchanged in a plain browser on the mock.
 */
export interface Backend {
  /** True inside the desktop app, false on the in-browser mock. */
  readonly native: boolean;
  /** Rejects with an `HttpError`. */
  send(id: string, spec: HttpRequestSpec): Promise<HttpResponseData>;
  cancel(id: string): Promise<void>;
  clearCookies(): Promise<void>;
  storeList(kind: StoreKind): Promise<string[]>;
  storeRead(kind: StoreKind, id: string): Promise<string | null>;
  storeWrite(kind: StoreKind, id: string, contents: string): Promise<void>;
  storeDelete(kind: StoreKind, id: string): Promise<void>;
  pickImportFiles(): Promise<PickedFile[]>;
  /** Path of a file to upload, or null if the dialog was cancelled. */
  pickFilePath(): Promise<string | null>;
  /** Resolves to where the file was saved, or null if cancelled. */
  saveTextFile(defaultName: string, contents: string): Promise<string | null>;
  saveResponseBody(defaultName: string, body: ResponseBody): Promise<string | null>;
  appInfo(): Promise<{ version: string; dataDir: string }>;
  /** Runs `flush` before the window closes. */
  onClose(flush: () => Promise<void>): void;
}

export const backend: Backend = "__TAURI_INTERNALS__" in window ? tauriBackend : mockBackend;
