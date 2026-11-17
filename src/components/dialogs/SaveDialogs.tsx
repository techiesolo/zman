import { useState } from "react";
import { listFolders } from "../../lib/tree";
import { newCollection } from "../../model/factory";
import { tabTitle, useApp } from "../../store/app";
import { Modal } from "../ui/Modal";

const NEW = "__new__";

export function SaveAsDialog({ tabId, closeAfter }: { tabId: string; closeAfter: boolean }) {
  const app = useApp.getState();
  const collections = useApp((s) => s.collections);
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const [name, setName] = useState(() => (tab ? tabTitle(app, tab) : ""));
  const [collectionId, setCollectionId] = useState(() => tab?.source?.collectionId ?? collections[0]?.id ?? NEW);
  const [folderId, setFolderId] = useState("");
  const [collectionName, setCollectionName] = useState("My Collection");

  if (!tab) return null;
  const collection = collections.find((c) => c.id === collectionId);
  const folders = collection ? listFolders(collection) : [];
  const valid = name.trim() !== "" && (collectionId !== NEW || collectionName.trim() !== "");

  const save = () => {
    if (!valid) return;
    const target = collectionId === NEW ? app.addCollection(newCollection(collectionName.trim())) : collectionId;
    const folder = folders.some((f) => f.id === folderId) ? folderId : null;
    app.saveTabAs(tabId, target, folder, name.trim());
    app.toggleExpanded(target, true);
    if (folder) app.toggleExpanded(folder, true);
    app.closeDialog();
    if (closeAfter) app.closeTab(tabId);
    else app.toast(`Saved “${name.trim()}”.`, "success");
  };

  return (
    <Modal
      title="Save request"
      onClose={app.closeDialog}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={app.closeDialog}>
            Cancel
          </button>
          <button type="submit" form="save-as" className="btn btn-primary" disabled={!valid}>
            Save
          </button>
        </>
      }
    >
      <form
        id="save-as"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          <span className="label">Request name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <label>
          <span className="label">Collection</span>
          <select
            className="input"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.target.value);
              setFolderId("");
            }}
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New collection…</option>
          </select>
        </label>
        {collectionId === NEW ? (
          <label>
            <span className="label">New collection name</span>
            <input className="input" value={collectionName} onChange={(e) => setCollectionName(e.target.value)} />
          </label>
        ) : (
          folders.length > 0 && (
            <label>
              <span className="label">Folder</span>
              <select className="input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">(top level)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {"  ".repeat(folder.depth)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
      </form>
    </Modal>
  );
}

export function CloseTabDialog({ tabId }: { tabId: string }) {
  const app = useApp.getState();
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const title = useApp((s) => (tab ? tabTitle(s, tab) : ""));
  if (!tab) return null;

  const save = () => {
    if (tab.source) {
      app.closeDialog();
      if (app.saveTab(tabId)) app.closeTab(tabId);
    } else {
      app.openDialog({ type: "saveAs", tabId, closeAfter: true });
    }
  };

  return (
    <Modal
      title="Unsaved changes"
      onClose={app.closeDialog}
      width={420}
      footer={
        <>
          <button
            type="button"
            className="btn mr-auto"
            onClick={() => {
              app.closeDialog();
              app.closeTab(tabId);
            }}
          >
            Don’t save
          </button>
          <button type="button" className="btn" onClick={app.closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={save}>
            {tab.source ? "Save and close" : "Save as…"}
          </button>
        </>
      }
    >
      <p className="m-0 leading-relaxed">
        <b>{title}</b> has changes that are not saved{tab.source ? "" : " to any collection"}. Closing the tab discards them.
      </p>
    </Modal>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm }: ConfirmDialogProps) {
  const closeDialog = useApp((s) => s.closeDialog);
  return (
    <Modal
      title={title}
      onClose={closeDialog}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            autoFocus
            onClick={() => {
              closeDialog();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="m-0 leading-relaxed">{message}</p>
    </Modal>
  );
}
