import { backend } from "../backend";
import { exportCollection, exportEnvironment, safeFileName, toJson } from "../lib/postman/export";
import { newId } from "../model/factory";
import type { Collection, Environment, KV } from "../model/types";
import { useApp } from "../store/app";

/** Things several parts of the UI trigger: file exports and confirmations. */

async function save(fileName: string, contents: string): Promise<void> {
  const { toast } = useApp.getState();
  try {
    const path = await backend.saveTextFile(fileName, contents);
    if (path) toast(`Exported to ${path}`, "success");
  } catch (error) {
    toast(`Export failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

export function exportCollectionFile(collection: Collection): Promise<void> {
  return save(safeFileName(collection.name, ".postman_collection.json"), toJson(exportCollection(collection)));
}

export function exportEnvironmentFile(environment: Environment): Promise<void> {
  return save(safeFileName(environment.name, ".postman_environment.json"), toJson(exportEnvironment(environment)));
}

export function exportGlobalsFile(globals: KV[]): Promise<void> {
  const doc = exportEnvironment({ id: newId(), name: "Globals", variables: globals }, "globals");
  return save("zman.postman_globals.json", toJson(doc));
}

export function confirmDelete(what: string, detail: string, onConfirm: () => void): void {
  useApp.getState().openDialog({
    type: "confirm",
    title: `Delete ${what}?`,
    message: detail,
    confirmLabel: "Delete",
    onConfirm,
  });
}
