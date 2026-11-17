import { useApp } from "../../store/app";
import { CodeDialog } from "./CodeDialog";
import { CollectionDialog } from "./CollectionDialog";
import { ImportDialog } from "./ImportDialog";
import { CloseTabDialog, ConfirmDialog, SaveAsDialog } from "./SaveDialogs";
import { SettingsDialog } from "./SettingsDialog";
import { VariablesDialog } from "./VariablesDialog";

/** Renders whichever dialog is open; there is at most one at a time. */
export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case "import":
      return <ImportDialog />;
    case "settings":
      return <SettingsDialog />;
    case "saveAs":
      return <SaveAsDialog key={dialog.tabId} tabId={dialog.tabId} closeAfter={dialog.closeAfter} />;
    case "closeTab":
      return <CloseTabDialog tabId={dialog.tabId} />;
    case "code":
      return <CodeDialog tabId={dialog.tabId} />;
    case "variables":
      return (
        <VariablesDialog key={dialog.target.kind === "environment" ? dialog.target.id : "globals"} target={dialog.target} />
      );
    case "collection":
      return <CollectionDialog key={dialog.folderId ?? dialog.collectionId} collectionId={dialog.collectionId} folderId={dialog.folderId} />;
    case "confirm":
      return (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
        />
      );
  }
}
