import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { backend } from "../backend";
import { buildRequest, effectiveAuth } from "../lib/buildRequest";
import { childrenOf, cloneCollection, cloneItem, containsId, findRequest, locate, walk } from "../lib/tree";
import { buildVarMap } from "../lib/variables";
import { emptyRequest, newCollection, newEnvironment, newFolder, newId, newRequestItem } from "../model/factory";
import {
  DEFAULT_SETTINGS,
  type Collection,
  type Environment,
  type FolderItem,
  type HistoryEntry,
  type HttpError,
  type HttpResponseData,
  type Item,
  type KV,
  type RequestDef,
  type Settings,
} from "../model/types";
import { loadAll, startPersistence } from "./persist";

export const HISTORY_LIMIT = 500;

export interface TabSource {
  collectionId: string;
  requestId: string;
}

export interface Tab {
  id: string;
  /** Used while the tab is not saved anywhere; saved tabs show the request's name. */
  name: string;
  /** The saved request this tab edits, or null for a scratch tab. */
  source: TabSource | null;
  draft: RequestDef;
  /** Whether a scratch tab has been edited. */
  touched: boolean;
}

/** Per-tab state that is not worth keeping across restarts. */
export interface TabRuntime {
  sending: boolean;
  sendId: string | null;
  response: HttpResponseData | null;
  error: HttpError | null;
  warnings: string[];
}

export const IDLE: TabRuntime = { sending: false, sendId: null, response: null, error: null, warnings: [] };

export type DialogState =
  | { type: "import" }
  | { type: "settings" }
  | { type: "saveAs"; tabId: string; closeAfter: boolean }
  | { type: "closeTab"; tabId: string }
  | { type: "code"; tabId: string }
  | { type: "variables"; target: { kind: "globals" } | { kind: "environment"; id: string } }
  | { type: "collection"; collectionId: string; folderId: string | null }
  | {
      type: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      onConfirm: () => void;
    };

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
}

export type SidebarView = "collections" | "environments" | "history";

export interface ItemRef {
  collectionId: string;
  itemId: string;
}

export interface AppState {
  ready: boolean;
  collections: Collection[];
  environments: Environment[];
  globals: KV[];
  history: HistoryEntry[];
  settings: Settings;
  tabs: Tab[];
  activeTabId: string | null;
  activeEnvId: string | null;
  /** Expanded collections and folders in the sidebar, by id. */
  expanded: Record<string, boolean>;
  sidebarView: SidebarView;
  layout: { sidebar: number; response: number };
  runtime: Record<string, TabRuntime>;
  dialog: DialogState | null;
  toasts: Toast[];

  init(): Promise<void>;
  toast(message: string, kind?: Toast["kind"]): void;
  dismissToast(id: string): void;
  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  setSidebarView(view: SidebarView): void;
  setLayout(patch: Partial<AppState["layout"]>): void;
  toggleExpanded(id: string, open?: boolean): void;
  updateSettings(patch: Partial<Settings>): void;

  addCollection(collection?: Collection): string;
  updateCollection(id: string, recipe: (collection: Collection) => void): void;
  duplicateCollection(id: string): void;
  deleteCollection(id: string): void;
  addFolder(collectionId: string, parentId: string | null): string | null;
  addRequest(collectionId: string, parentId: string | null, name?: string, request?: RequestDef): string | null;
  updateItem(ref: ItemRef, recipe: (item: Item) => void): void;
  duplicateItem(ref: ItemRef): void;
  deleteItem(ref: ItemRef): void;
  moveItem(from: ItemRef, to: { collectionId: string; parentId: string | null; index: number }): void;

  addEnvironment(environment?: Environment): string;
  updateEnvironment(id: string, recipe: (environment: Environment) => void): void;
  duplicateEnvironment(id: string): void;
  deleteEnvironment(id: string): void;
  setActiveEnv(id: string | null): void;
  setGlobals(rows: KV[]): void;

  newTab(request?: RequestDef, name?: string): string;
  openRequest(collectionId: string, requestId: string): void;
  openHistory(entry: HistoryEntry): void;
  setActiveTab(id: string): void;
  closeTab(id: string): void;
  /** Closes the tab, asking first if it has unsaved changes. */
  requestCloseTab(id: string): void;
  renameTab(id: string, name: string): void;
  updateDraft(id: string, recipe: (draft: RequestDef) => void): void;
  /** Saves in place, or opens "Save as" for a scratch tab. Returns whether it saved. */
  saveTab(id: string): boolean;
  saveTabAs(id: string, collectionId: string, folderId: string | null, name: string): void;
  revertTab(id: string): void;

  send(tabId: string): Promise<void>;
  cancel(tabId: string): void;
  deleteHistory(id: string): void;
  clearHistory(): void;
}

function toHttpError(error: unknown): HttpError {
  if (typeof error === "object" && error !== null && "kind" in error && "message" in error) {
    return error as HttpError;
  }
  return { kind: "other", message: error instanceof Error ? error.message : String(error) };
}

function requestIds(item: Item): Set<string> {
  const ids = new Set<string>();
  walk([item], (node) => {
    if (node.type === "request") ids.add(node.id);
  });
  return ids;
}

/** Turns tabs whose saved request is going away into unsaved scratch tabs. */
function detachTabs(state: AppState, collectionId: string, ids: Set<string> | "all"): void {
  for (const tab of state.tabs) {
    if (tab.source?.collectionId !== collectionId) continue;
    if (ids !== "all" && !ids.has(tab.source.requestId)) continue;
    const collection = state.collections.find((c) => c.id === collectionId);
    tab.name = findRequest(collection, tab.source.requestId)?.name ?? tab.name;
    tab.source = null;
    tab.touched = true;
  }
}

function copyName(name: string): string {
  return `${name} Copy`;
}

export const useApp = create<AppState>()(
  immer((set, get) => ({
    ready: false,
    collections: [],
    environments: [],
    globals: [],
    history: [],
    settings: DEFAULT_SETTINGS,
    tabs: [],
    activeTabId: null,
    activeEnvId: null,
    expanded: {},
    sidebarView: "collections",
    layout: { sidebar: 300, response: 0.45 },
    runtime: {},
    dialog: null,
    toasts: [],

    async init() {
      const loaded = await loadAll();
      set((s) => {
        Object.assign(s, loaded.state);
        if (s.tabs.length === 0) {
          const tab: Tab = { id: newId(), name: "Untitled Request", source: null, draft: emptyRequest(), touched: false };
          s.tabs.push(tab);
          s.activeTabId = tab.id;
        }
        s.ready = true;
      });
      for (const problem of loaded.problems) get().toast(problem, "error");
      startPersistence(useApp, (message) => get().toast(message, "error"));
    },

    toast(message, kind = "info") {
      set((s) => {
        s.toasts.push({ id: newId(), kind, message });
        if (s.toasts.length > 4) s.toasts.shift();
      });
    },
    dismissToast(id) {
      set((s) => {
        s.toasts = s.toasts.filter((t) => t.id !== id);
      });
    },
    openDialog(dialog) {
      set((s) => {
        s.dialog = dialog;
      });
    },
    closeDialog() {
      set((s) => {
        s.dialog = null;
      });
    },
    setSidebarView(view) {
      set((s) => {
        s.sidebarView = view;
      });
    },
    setLayout(patch) {
      set((s) => {
        Object.assign(s.layout, patch);
      });
    },
    toggleExpanded(id, open) {
      set((s) => {
        const next = open ?? !s.expanded[id];
        if (next) s.expanded[id] = true;
        else delete s.expanded[id];
      });
    },
    updateSettings(patch) {
      set((s) => {
        Object.assign(s.settings, patch);
      });
    },

    /* ---------- Collections ---------- */

    addCollection(collection = newCollection()) {
      set((s) => {
        s.collections.push(collection);
        s.expanded[collection.id] = true;
        s.sidebarView = "collections";
      });
      return collection.id;
    },
    updateCollection(id, recipe) {
      set((s) => {
        const collection = s.collections.find((c) => c.id === id);
        if (collection) recipe(collection);
      });
    },
    duplicateCollection(id) {
      set((s) => {
        const index = s.collections.findIndex((c) => c.id === id);
        if (index < 0) return;
        const copy = cloneCollection(s.collections[index]!);
        copy.name = copyName(copy.name);
        s.collections.splice(index + 1, 0, copy);
      });
    },
    deleteCollection(id) {
      set((s) => {
        detachTabs(s, id, "all");
        s.collections = s.collections.filter((c) => c.id !== id);
        delete s.expanded[id];
      });
    },
    addFolder(collectionId, parentId) {
      const folder = newFolder();
      let added = false;
      set((s) => {
        const collection = s.collections.find((c) => c.id === collectionId);
        const children = collection && childrenOf(collection, parentId);
        if (!children) return;
        children.push(folder);
        s.expanded[parentId ?? collectionId] = true;
        added = true;
      });
      return added ? folder.id : null;
    },
    addRequest(collectionId, parentId, name, request) {
      const item = newRequestItem(name, request);
      let added = false;
      set((s) => {
        const collection = s.collections.find((c) => c.id === collectionId);
        const children = collection && childrenOf(collection, parentId);
        if (!children) return;
        children.push(item);
        s.expanded[collectionId] = true;
        if (parentId) s.expanded[parentId] = true;
        added = true;
      });
      return added ? item.id : null;
    },
    updateItem(ref, recipe) {
      set((s) => {
        const collection = s.collections.find((c) => c.id === ref.collectionId);
        const found = collection && locate(collection, ref.itemId);
        if (found) recipe(found.item);
      });
    },
    duplicateItem(ref) {
      set((s) => {
        const collection = s.collections.find((c) => c.id === ref.collectionId);
        const found = collection && locate(collection, ref.itemId);
        if (!found) return;
        const copy = cloneItem(found.item);
        copy.name = copyName(copy.name);
        found.siblings.splice(found.index + 1, 0, copy);
      });
    },
    deleteItem(ref) {
      set((s) => {
        const collection = s.collections.find((c) => c.id === ref.collectionId);
        const found = collection && locate(collection, ref.itemId);
        if (!found) return;
        detachTabs(s, ref.collectionId, requestIds(found.item));
        found.siblings.splice(found.index, 1);
      });
    },
    moveItem(from, to) {
      set((s) => {
        const source = s.collections.find((c) => c.id === from.collectionId);
        const target = s.collections.find((c) => c.id === to.collectionId);
        const found = source && locate(source, from.itemId);
        if (!found || !target) return;
        // A folder cannot be moved into itself.
        if (to.parentId !== null && containsId(found.item, to.parentId)) return;
        const destination = childrenOf(target, to.parentId);
        if (!destination) return;

        let index = Math.max(0, Math.min(to.index, destination.length));
        if (destination === found.siblings && found.index < index) index--;
        found.siblings.splice(found.index, 1);
        destination.splice(index, 0, found.item);

        if (from.collectionId !== to.collectionId) {
          const moved = requestIds(found.item);
          for (const tab of s.tabs) {
            if (tab.source?.collectionId === from.collectionId && moved.has(tab.source.requestId)) {
              tab.source.collectionId = to.collectionId;
            }
          }
        }
        if (to.parentId) s.expanded[to.parentId] = true;
        s.expanded[to.collectionId] = true;
      });
    },

    /* ---------- Environments ---------- */

    addEnvironment(environment = newEnvironment()) {
      set((s) => {
        s.environments.push(environment);
      });
      return environment.id;
    },
    updateEnvironment(id, recipe) {
      set((s) => {
        const environment = s.environments.find((e) => e.id === id);
        if (environment) recipe(environment);
      });
    },
    duplicateEnvironment(id) {
      set((s) => {
        const index = s.environments.findIndex((e) => e.id === id);
        if (index < 0) return;
        const copy = structuredClone(get().environments[index]!);
        copy.id = newId();
        copy.name = copyName(copy.name);
        copy.variables = copy.variables.map((row) => ({ ...row, id: newId() }));
        s.environments.splice(index + 1, 0, copy);
      });
    },
    deleteEnvironment(id) {
      set((s) => {
        s.environments = s.environments.filter((e) => e.id !== id);
        if (s.activeEnvId === id) s.activeEnvId = null;
      });
    },
    setActiveEnv(id) {
      set((s) => {
        s.activeEnvId = id;
      });
    },
    setGlobals(rows) {
      set((s) => {
        s.globals = rows;
      });
    },

    /* ---------- Tabs ---------- */

    newTab(request = emptyRequest(), name = "Untitled Request") {
      const tab: Tab = { id: newId(), name, source: null, draft: request, touched: false };
      set((s) => {
        s.tabs.push(tab);
        s.activeTabId = tab.id;
      });
      return tab.id;
    },
    openRequest(collectionId, requestId) {
      const state = get();
      const open = state.tabs.find(
        (t) => t.source?.collectionId === collectionId && t.source.requestId === requestId,
      );
      if (open) {
        state.setActiveTab(open.id);
        return;
      }
      const item = findRequest(
        state.collections.find((c) => c.id === collectionId),
        requestId,
      );
      if (!item) return;
      const tab: Tab = {
        id: newId(),
        name: item.name,
        source: { collectionId, requestId },
        draft: structuredClone(item.request),
        touched: false,
      };
      set((s) => {
        s.tabs.push(tab);
        s.activeTabId = tab.id;
      });
    },
    openHistory(entry) {
      const state = get();
      const saved =
        entry.source &&
        findRequest(
          state.collections.find((c) => c.id === entry.source!.collectionId),
          entry.source.requestId,
        );
      const tab: Tab = {
        id: newId(),
        name: entry.name,
        // Staying linked to the saved request keeps its inherited auth and
        // collection variables working.
        source: saved ? { ...entry.source! } : null,
        draft: structuredClone(entry.request),
        touched: true,
      };
      set((s) => {
        const open = saved
          ? s.tabs.find(
              (t) => t.source?.collectionId === tab.source!.collectionId && t.source.requestId === tab.source!.requestId,
            )
          : undefined;
        if (open) {
          open.draft = tab.draft;
          s.activeTabId = open.id;
        } else {
          s.tabs.push(tab);
          s.activeTabId = tab.id;
        }
      });
    },
    setActiveTab(id) {
      set((s) => {
        s.activeTabId = id;
      });
    },
    closeTab(id) {
      const running = get().runtime[id];
      if (running?.sending && running.sendId) void backend.cancel(running.sendId);
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index < 0) return;
        s.tabs.splice(index, 1);
        delete s.runtime[id];
        if (s.activeTabId === id) s.activeTabId = (s.tabs[index] ?? s.tabs[index - 1])?.id ?? null;
      });
    },
    requestCloseTab(id) {
      const state = get();
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return;
      if (isTabDirty(state, tab)) state.openDialog({ type: "closeTab", tabId: id });
      else state.closeTab(id);
    },
    renameTab(id, name) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (tab) tab.name = name;
      });
    },
    updateDraft(id, recipe) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) return;
        recipe(tab.draft);
        tab.touched = true;
      });
    },
    saveTab(id) {
      const state = get();
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return false;
      if (!tab.source) {
        state.openDialog({ type: "saveAs", tabId: id, closeAfter: false });
        return false;
      }
      const source = tab.source;
      const draft = structuredClone(tab.draft);
      state.updateItem({ collectionId: source.collectionId, itemId: source.requestId }, (item) => {
        if (item.type === "request") item.request = draft;
      });
      return true;
    },
    saveTabAs(id, collectionId, folderId, name) {
      const state = get();
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return;
      const requestId = state.addRequest(collectionId, folderId, name, structuredClone(tab.draft));
      if (!requestId) return;
      set((s) => {
        const target = s.tabs.find((t) => t.id === id);
        if (!target) return;
        target.source = { collectionId, requestId };
        target.name = name;
        target.touched = false;
      });
    },
    revertTab(id) {
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab?.source) return;
        const saved = findRequest(
          s.collections.find((c) => c.id === tab.source!.collectionId),
          tab.source.requestId,
        );
        if (saved) tab.draft = saved.request;
      });
    },

    /* ---------- Sending ---------- */

    async send(tabId) {
      const state = get();
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab || state.runtime[tabId]?.sending) return;

      const context = tabContext(state, tab);
      const environment = state.environments.find((e) => e.id === state.activeEnvId);
      const vars = buildVarMap(state.globals, context?.collection.variables, environment?.variables);
      const { auth } = effectiveAuth(tab.draft.auth, context?.ancestors ?? [], context?.collection);

      const setRuntime = (patch: Partial<TabRuntime>) =>
        set((s) => {
          if (s.tabs.some((t) => t.id === tabId)) s.runtime[tabId] = { ...(s.runtime[tabId] ?? IDLE), ...patch };
        });

      let built: ReturnType<typeof buildRequest>;
      try {
        built = buildRequest({ request: tab.draft, auth, vars, settings: state.settings });
      } catch (error) {
        setRuntime({
          ...IDLE,
          error: { kind: "invalidRequest", message: error instanceof Error ? error.message : String(error) },
        });
        return;
      }

      const sendId = newId();
      setRuntime({ sending: true, sendId, error: null, warnings: built.warnings });

      const entry: HistoryEntry = {
        id: newId(),
        at: new Date().toISOString(),
        name: tabTitle(state, tab),
        request: structuredClone(tab.draft),
        resolvedUrl: built.spec.url,
        ...(tab.source ? { source: { ...tab.source } } : {}),
      };
      const record = (result: Partial<HistoryEntry>) =>
        set((s) => {
          s.history.unshift({ ...entry, ...result });
          if (s.history.length > HISTORY_LIMIT) s.history.length = HISTORY_LIMIT;
        });
      // The tab may have been closed, or the request superseded, meanwhile.
      const current = () => get().runtime[tabId]?.sendId === sendId;

      try {
        const response = await backend.send(sendId, built.spec);
        if (!current()) return;
        setRuntime({ sending: false, sendId: null, response, error: null });
        record({ status: response.status, timeMs: response.timeMs, sizeBytes: response.sizeBytes });
      } catch (raw) {
        if (!current()) return;
        const error = toHttpError(raw);
        setRuntime({ sending: false, sendId: null, response: null, error });
        if (error.kind !== "cancelled") record({ error: error.message });
      }
    },
    cancel(tabId) {
      const running = get().runtime[tabId];
      if (running?.sending && running.sendId) void backend.cancel(running.sendId);
    },
    deleteHistory(id) {
      set((s) => {
        s.history = s.history.filter((h) => h.id !== id);
      });
    },
    clearHistory() {
      set((s) => {
        s.history = [];
      });
    },
  })),
);

/* ---------- Derived state ---------- */

export interface TabContext {
  collection: Collection;
  ancestors: FolderItem[];
  name: string;
  saved: RequestDef;
}

/** Where the tab's saved request lives, or null for a scratch tab. */
export function tabContext(state: Pick<AppState, "collections">, tab: Tab): TabContext | null {
  if (!tab.source) return null;
  const collection = state.collections.find((c) => c.id === tab.source!.collectionId);
  const found = collection && locate(collection, tab.source.requestId);
  if (!collection || !found || found.item.type !== "request") return null;
  return { collection, ancestors: found.ancestors, name: found.item.name, saved: found.item.request };
}

export function tabTitle(state: Pick<AppState, "collections">, tab: Tab): string {
  return tabContext(state, tab)?.name ?? tab.name;
}

const sameCache = new WeakMap<RequestDef, WeakMap<RequestDef, boolean>>();

function sameRequest(a: RequestDef, b: RequestDef): boolean {
  if (a === b) return true;
  let inner = sameCache.get(a);
  if (!inner) sameCache.set(a, (inner = new WeakMap()));
  let same = inner.get(b);
  if (same === undefined) inner.set(b, (same = JSON.stringify(a) === JSON.stringify(b)));
  return same;
}

export function isTabDirty(state: Pick<AppState, "collections">, tab: Tab): boolean {
  const context = tabContext(state, tab);
  return context ? !sameRequest(context.saved, tab.draft) : tab.touched;
}
