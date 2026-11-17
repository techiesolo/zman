import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Backend } from "./index";

export const tauriBackend: Backend = {
  native: true,
  send: (id, spec) => invoke("http_send", { id, spec }),
  cancel: async (id) => {
    await invoke("http_cancel", { id });
  },
  clearCookies: () => invoke("http_clear_cookies"),
  storeList: (kind) => invoke("store_list", { kind }),
  storeRead: (kind, id) => invoke("store_read", { kind, id }),
  storeWrite: (kind, id, contents) => invoke("store_write", { kind, id, contents }),
  storeDelete: (kind, id) => invoke("store_delete", { kind, id }),
  pickImportFiles: () => invoke("import_pick_files"),
  pickFilePath: () => invoke("pick_file_path"),
  saveTextFile: (defaultName, contents) => invoke("export_save_file", { defaultName, contents }),
  saveResponseBody: (defaultName, body) => invoke("save_response_body", { defaultName, body }),
  appInfo: () => invoke("app_info"),
  onClose: (flush) => {
    // Tauri closes the window once this handler has settled.
    void getCurrentWindow().onCloseRequested(async () => {
      await flush().catch(() => undefined);
    });
  },
};
