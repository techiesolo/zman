import { ChevronDown, Code2, Loader2, RotateCcw, Save, SaveAll, Send, Square } from "lucide-react";
import { useEffect, useMemo, useState, type ClipboardEvent } from "react";
import { effectiveAuth } from "../lib/buildRequest";
import { CurlParseError, looksLikeCurl, parseCurl } from "../lib/curl/parse";
import { setUrlQuery, syncParamsFromUrl, syncPathVars } from "../lib/url";
import { kv } from "../model/factory";
import { HTTP_METHODS, type RequestDef } from "../model/types";
import { isTabDirty, tabContext, useApp, type Tab } from "../store/app";
import { AuthEditor } from "./AuthEditor";
import { BodyEditor } from "./BodyEditor";
import { methodColor, TabStrip, type TabOption } from "./ui/bits";
import { KVTable } from "./ui/KVTable";
import { Dropdown, type MenuEntry } from "./ui/Menu";
import { VarInput } from "./ui/VarInput";

type Section = "params" | "auth" | "headers" | "body";

/** The section each tab was last showing, for the lifetime of the window. */
const lastSection = new Map<string, Section>();

function NameField({ tab, name }: { tab: Tab; name: string }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === name) {
      setValue(name);
      return;
    }
    const app = useApp.getState();
    if (tab.source) {
      app.updateItem({ collectionId: tab.source.collectionId, itemId: tab.source.requestId }, (item) => void (item.name = next));
    } else {
      app.renameTab(tab.id, next);
    }
  };

  return (
    <input
      className="cell-input h-6 min-w-0 flex-1 rounded px-1 font-semibold hover:bg-hover focus:bg-hover"
      aria-label="Request name"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function RequestEditor({ tabId }: { tabId: string }) {
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const collections = useApp((s) => s.collections);
  const context = useMemo(() => (tab ? tabContext({ collections }, tab) : null), [collections, tab]);
  const dirty = useApp((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t ? isTabDirty(s, t) : false;
  });
  const sending = useApp((s) => s.runtime[tabId]?.sending ?? false);
  const [section, setSectionState] = useState<Section>(() => lastSection.get(tabId) ?? "params");

  if (!tab) return null;
  const app = useApp.getState();
  const draft = tab.draft;
  const update = (recipe: (draft: RequestDef) => void) => app.updateDraft(tabId, recipe);
  const setSection = (next: Section) => {
    lastSection.set(tabId, next);
    setSectionState(next);
  };

  const setUrl = (url: string) => {
    const params = syncParamsFromUrl(url, draft.params);
    const pathVars = syncPathVars(url, draft.pathVars);
    update((d) => {
      d.url = url;
      d.params = params;
      d.pathVars = pathVars;
    });
  };

  const pasteIntoUrl = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!looksLikeCurl(text)) return;
    event.preventDefault();
    try {
      const { request, warnings } = parseCurl(text);
      update((d) => void Object.assign(d, request));
      app.toast(
        warnings.length > 0 ? `Imported the cURL command. ${warnings.join(" ")}` : "Imported the cURL command.",
        warnings.length > 0 ? "info" : "success",
      );
    } catch (error) {
      app.toast(
        error instanceof CurlParseError ? `Could not read the cURL command: ${error.message}` : String(error),
        "error",
      );
    }
  };

  const inherited = effectiveAuth({ type: "inherit" }, context?.ancestors ?? [], context?.collection);
  const authInUse = draft.auth.type === "inherit" ? inherited.inheritedFrom !== undefined : draft.auth.type !== "none";

  const sections: TabOption<Section>[] = [
    { id: "params", label: "Params", badge: draft.params.filter((p) => p.enabled && p.key !== "").length },
    { id: "auth", label: "Authorization", badge: authInUse },
    { id: "headers", label: "Headers", badge: draft.headers.filter((h) => h.enabled && h.key !== "").length },
    { id: "body", label: "Body", badge: draft.body.mode !== "none" },
  ];

  const methods: string[] = [...HTTP_METHODS];
  if (!methods.includes(draft.method)) methods.push(draft.method);

  const saveEntries: MenuEntry[] = [
    {
      label: "Save as…",
      icon: <SaveAll size={14} />,
      onSelect: () => app.openDialog({ type: "saveAs", tabId, closeAfter: false }),
    },
    {
      label: "Revert changes",
      icon: <RotateCcw size={14} />,
      disabled: !tab.source || !dirty,
      onSelect: () => app.revertTab(tabId),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 flex-none items-center gap-1 px-3 pt-1 text-xs text-muted">
        {context ? (
          <>
            <span className="max-w-40 flex-none truncate">{context.collection.name}</span>
            <span className="text-faint">/</span>
            {context.ancestors.map((folder) => (
              <span key={folder.id} className="flex min-w-0 flex-none items-center gap-1">
                <span className="max-w-32 truncate">{folder.name}</span>
                <span className="text-faint">/</span>
              </span>
            ))}
          </>
        ) : (
          <span className="flex-none rounded bg-hover px-1.5 py-0.5 text-[11px]">Not saved</span>
        )}
        <span className="flex min-w-0 flex-1 text-[13px] text-fg">
          <NameField tab={tab} name={context?.name ?? tab.name} />
        </span>
      </div>

      <div className="flex flex-none items-center gap-2 px-3 py-2">
        <div className="input flex min-w-0 flex-1 items-center p-0">
          <select
            aria-label="Method"
            className="h-full flex-none rounded-l-md border-0 bg-transparent pr-1 pl-2 text-xs font-bold outline-none"
            style={{ color: methodColor(draft.method) }}
            value={draft.method}
            onChange={(e) => update((d) => void (d.method = e.target.value))}
          >
            {methods.map((method) => (
              <option key={method} value={method} style={{ color: methodColor(method) }}>
                {method}
              </option>
            ))}
          </select>
          <span className="h-4 w-px flex-none bg-line" />
          <VarInput
            mono
            ariaLabel="Request URL"
            placeholder="Enter a URL or paste a cURL command"
            value={draft.url}
            onChange={setUrl}
            onPaste={pasteIntoUrl}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) void app.send(tabId);
            }}
          />
        </div>

        {sending ? (
          <button type="button" className="btn w-24" onClick={() => app.cancel(tabId)}>
            <Square size={12} fill="currentColor" /> Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary w-24"
            title="Send (Ctrl+Enter)"
            disabled={draft.url.trim() === ""}
            onClick={() => void app.send(tabId)}
          >
            <Send size={14} /> Send
          </button>
        )}

        <div className="flex flex-none">
          <button
            type="button"
            className="btn rounded-r-none"
            title="Save (Ctrl+S)"
            disabled={tab.source !== null && !dirty}
            onClick={() => app.saveTab(tabId)}
          >
            <Save size={14} /> Save
          </button>
          <Dropdown entries={saveEntries} align="end">
            <button type="button" className="btn -ml-px rounded-l-none px-1.5" aria-label="More save options">
              <ChevronDown size={14} />
            </button>
          </Dropdown>
        </div>

        <button
          type="button"
          className="btn px-2"
          title="Copy as cURL"
          aria-label="Copy as cURL"
          onClick={() => app.openDialog({ type: "code", tabId })}
        >
          <Code2 size={15} />
        </button>
      </div>

      <TabStrip label="Request sections" tabs={sections} active={section} onSelect={setSection}>
        {sending && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={13} className="spin" /> Sending…
          </span>
        )}
      </TabStrip>

      <div className="min-h-0 flex-1 overflow-hidden">
        {section === "params" && (
          <div className="flex h-full flex-col gap-3 overflow-auto p-3">
            <KVTable
              ariaLabel="Query parameters"
              rows={draft.params}
              onChange={(rows) => {
                const url = setUrlQuery(draft.url, rows);
                update((d) => {
                  d.params = rows;
                  d.url = url;
                });
              }}
              make={(id) => ({ ...kv(), id })}
            />
            {draft.pathVars.length > 0 && (
              <div>
                <div className="label">Path variables</div>
                <KVTable
                  ariaLabel="Path variables"
                  rows={draft.pathVars}
                  onChange={(rows) => update((d) => void (d.pathVars = rows))}
                  make={(id) => ({ ...kv(), id })}
                  keyLabel="Variable"
                  fixedKeys
                />
              </div>
            )}
            <p className="m-0 text-xs text-faint">
              Parameters stay in sync with the URL. Write <code className="font-mono">:name</code> in the path to add a path
              variable, and <code className="font-mono">{"{{name}}"}</code> anywhere to use a variable.
            </p>
          </div>
        )}

        {section === "auth" && (
          <div className="h-full overflow-auto p-3">
            <AuthEditor
              auth={draft.auth}
              onChange={(auth) => update((d) => void (d.auth = auth))}
              allowInherit
              inherited={{ auth: inherited.auth, from: inherited.inheritedFrom }}
            />
          </div>
        )}

        {section === "headers" && (
          <div className="flex h-full flex-col gap-3 overflow-auto p-3">
            <KVTable
              ariaLabel="Headers"
              rows={draft.headers}
              onChange={(rows) => update((d) => void (d.headers = rows))}
              make={(id) => ({ ...kv(), id })}
              keyLabel="Header"
            />
            <p className="m-0 text-xs text-faint">
              <code className="font-mono">User-Agent</code>, <code className="font-mono">Accept</code>,{" "}
              <code className="font-mono">Content-Type</code> and <code className="font-mono">Authorization</code> are added
              automatically when you do not set them here.
            </p>
          </div>
        )}

        {section === "body" && <BodyEditor body={draft.body} onChange={(recipe) => update((d) => recipe(d.body))} />}
      </div>
    </div>
  );
}
