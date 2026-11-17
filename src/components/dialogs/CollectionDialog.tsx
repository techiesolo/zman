import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { effectiveAuth } from "../../lib/buildRequest";
import { locate } from "../../lib/tree";
import { kv } from "../../model/factory";
import type { Auth } from "../../model/types";
import { useApp } from "../../store/app";
import { AuthEditor } from "../AuthEditor";
import { TabStrip, type TabOption } from "../ui/bits";
import { KVTable } from "../ui/KVTable";
import { Modal } from "../ui/Modal";
import { useScopeVars, VarsContext } from "../vars";

type Section = "general" | "auth" | "variables";

function hasScripts(postman: { event?: unknown } | undefined): boolean {
  return Array.isArray(postman?.event) && postman.event.length > 0;
}

/** Name, description, authorization and (for collections) variables of a collection or folder. */
export function CollectionDialog({ collectionId, folderId }: { collectionId: string; folderId: string | null }) {
  const app = useApp.getState();
  const collection = useApp((s) => s.collections.find((c) => c.id === collectionId));
  const vars = useScopeVars(collectionId);
  const [section, setSection] = useState<Section>("auth");

  if (!collection) return null;
  const found = folderId ? locate(collection, folderId) : null;
  const folder = found?.item.type === "folder" ? found.item : null;
  if (folderId && !folder) return null;
  const target = folder ?? collection;

  const patch = (recipe: (target: { name: string; description?: string; auth: Auth }) => void) => {
    if (folder) app.updateItem({ collectionId, itemId: folder.id }, (item) => recipe(item as typeof folder));
    else app.updateCollection(collectionId, recipe);
  };

  const sections: TabOption<Section>[] = [
    { id: "auth", label: "Authorization", badge: target.auth.type !== "none" && target.auth.type !== "inherit" },
    ...(folder ? [] : [{ id: "variables" as const, label: "Variables", badge: collection.variables.length }]),
    { id: "general", label: "General" },
  ];
  const inherited = folder ? effectiveAuth({ type: "inherit" }, found?.ancestors ?? [], collection) : undefined;

  return (
    <Modal
      title={folder ? `Folder: ${folder.name}` : `Collection: ${collection.name}`}
      onClose={app.closeDialog}
      width={720}
      tall
      footer={
        <button type="button" className="btn btn-primary" onClick={app.closeDialog}>
          Done
        </button>
      }
    >
      <VarsContext.Provider value={vars}>
        <div className="-mx-4 -mt-4 mb-4">
          <TabStrip label="Sections" tabs={sections} active={section} onSelect={(id) => setSection(id)} />
        </div>

        {section === "auth" && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-xs leading-relaxed text-muted">
              Requests {folder ? "in this folder" : "in this collection"} whose authorization is “Inherit from parent” use
              these settings.
            </p>
            <AuthEditor
              auth={target.auth}
              onChange={(auth) => patch((t) => void (t.auth = auth))}
              allowInherit={folder !== null}
              inherited={inherited && { auth: inherited.auth, from: inherited.inheritedFrom }}
            />
          </div>
        )}

        {section === "variables" && !folder && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-xs leading-relaxed text-muted">
              Collection variables are available to every request in this collection. The active environment overrides
              a collection variable with the same name.
            </p>
            <VarsContext.Provider value={null}>
              <KVTable
                ariaLabel="Collection variables"
                rows={collection.variables}
                onChange={(rows) => app.updateCollection(collectionId, (c) => void (c.variables = rows))}
                make={(id) => ({ ...kv(), id })}
                keyLabel="Variable"
                variablesInKey={false}
              />
            </VarsContext.Provider>
          </div>
        )}

        {section === "general" && (
          <div className="flex flex-col gap-3">
            <label>
              <span className="label">Name</span>
              <input className="input" value={target.name} onChange={(e) => patch((t) => void (t.name = e.target.value))} />
            </label>
            <label>
              <span className="label">Description</span>
              <textarea
                className="input min-h-32"
                value={target.description ?? ""}
                onChange={(e) => patch((t) => void (t.description = e.target.value || undefined))}
              />
            </label>
            {hasScripts(target.postman) && (
              <p className="m-0 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-xs leading-relaxed">
                <AlertTriangle size={14} className="mt-0.5 flex-none text-warn" />
                <span>
                  This {folder ? "folder" : "collection"} came with Postman scripts. zman does not run scripts; they are
                  kept and written back when you export.
                </span>
              </p>
            )}
          </div>
        )}
      </VarsContext.Provider>
    </Modal>
  );
}
