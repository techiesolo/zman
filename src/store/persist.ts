import type { StoreApi } from "zustand";
import { backend, type StoreKind } from "../backend";
import { findRequest } from "../lib/tree";
import { emptyRequest, newId } from "../model/factory";
import {
  DEFAULT_SETTINGS,
  type Collection,
  type Environment,
  type HistoryEntry,
  type KV,
  type Settings,
} from "../model/types";
import { HISTORY_LIMIT, type AppState, type SidebarView, type Tab } from "./app";

/**
 * On disk the app is a set of small JSON documents:
 *
 *   collections/<id>    one Collection each
 *   environments/<id>   one Environment each
 *   app/globals         { variables }
 *   app/history         { entries }
 *   app/state           open tabs, settings and other UI state
 */

const DEBOUNCE_MS = 400;

interface StateDoc {
  version: 1;
  settings: Settings;
  tabs: Tab[];
  activeTabId: string | null;
  activeEnvId: string | null;
  expanded: Record<string, boolean>;
  sidebarView: SidebarView;
  layout: AppState["layout"];
  collectionOrder: string[];
  environmentOrder: string[];
}

type Loaded = Pick<
  AppState,
  | "collections"
  | "environments"
  | "globals"
  | "history"
  | "settings"
  | "tabs"
  | "activeTabId"
  | "activeEnvId"
  | "expanded"
  | "sidebarView"
  | "layout"
>;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRows(value: unknown): value is KV[] {
  return Array.isArray(value) && value.every((row) => isObj(row) && typeof row.key === "string");
}

function isCollection(value: unknown): value is Collection {
  return isObj(value) && typeof value.name === "string" && Array.isArray(value.items) && isRows(value.variables);
}

function isEnvironment(value: unknown): value is Environment {
  return isObj(value) && typeof value.name === "string" && isRows(value.variables);
}

function isTab(value: unknown): value is Tab {
  return (
    isObj(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isObj(value.draft) &&
    typeof value.draft.url === "string" &&
    isObj(value.draft.body) &&
    isObj(value.draft.auth)
  );
}

function byOrder<T extends { id: string; name: string }>(docs: T[], order: unknown): T[] {
  const rank = new Map<string, number>();
  if (Array.isArray(order)) order.forEach((id, index) => rank.set(String(id), index));
  return [...docs].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}

export async function loadAll(): Promise<{ state: Loaded; problems: string[] }> {
  const problems: string[] = [];

  /** Reads every document of a kind. Unreadable ones are reported and left alone. */
  async function readDocs<T extends { id: string }>(
    kind: StoreKind,
    valid: (value: unknown) => value is T,
  ): Promise<T[]> {
    let ids: string[];
    try {
      ids = await backend.storeList(kind);
    } catch (error) {
      problems.push(`Could not list ${kind}: ${String(error)}`);
      return [];
    }
    const docs: T[] = [];
    for (const id of ids) {
      try {
        const text = await backend.storeRead(kind, id);
        if (text === null) continue;
        const value: unknown = JSON.parse(text);
        if (!valid(value)) throw new Error("unexpected contents");
        value.id = id;
        docs.push(value);
      } catch (error) {
        problems.push(`Skipped ${kind}/${id}.json (${error instanceof Error ? error.message : String(error)}). The file was left untouched.`);
      }
    }
    return docs;
  }

  /**
   * Reads one of the app documents. A broken one is copied aside before the
   * app starts over with defaults, since it would otherwise be overwritten.
   */
  async function readAppDoc(id: string): Promise<Obj | null> {
    let text: string | null = null;
    try {
      text = await backend.storeRead("app", id);
      if (text === null) return null;
      const value: unknown = JSON.parse(text);
      if (!isObj(value)) throw new Error("unexpected contents");
      return value;
    } catch (error) {
      let note = "";
      if (text !== null) {
        const backup = `${id}-broken-${Date.now()}`;
        try {
          await backend.storeWrite("app", backup, text);
          note = ` A copy was kept as ${backup}.json.`;
        } catch {
          // Nothing more can be done about it here.
        }
      }
      problems.push(`Could not read ${id}.json (${error instanceof Error ? error.message : String(error)}).${note}`);
      return null;
    }
  }

  const [collectionDocs, environmentDocs, globalsDoc, historyDoc, stateDoc] = await Promise.all([
    readDocs("collections", isCollection),
    readDocs("environments", isEnvironment),
    readAppDoc("globals"),
    readAppDoc("history"),
    readAppDoc("state"),
  ]);

  const saved = (stateDoc ?? {}) as Partial<StateDoc>;
  const collections = byOrder(collectionDocs, saved.collectionOrder);
  for (const collection of collections) collection.auth ??= { type: "none" };
  const environments = byOrder(environmentDocs, saved.environmentOrder);

  const tabs: Tab[] = [];
  for (const raw of Array.isArray(saved.tabs) ? saved.tabs : []) {
    if (!isTab(raw)) continue;
    const tab: Tab = { ...raw, draft: { ...emptyRequest(), ...raw.draft }, source: raw.source ?? null, touched: !!raw.touched };
    if (tab.source) {
      const source = tab.source;
      const exists = findRequest(
        collections.find((c) => c.id === source.collectionId),
        source.requestId,
      );
      // Its collection is gone from disk: keep the work as an unsaved tab.
      if (!exists) {
        tab.source = null;
        tab.touched = true;
      }
    }
    if (tabs.some((t) => t.id === tab.id)) tab.id = newId();
    tabs.push(tab);
  }

  const layout = { sidebar: 300, response: 0.45 };
  if (isObj(saved.layout)) {
    if (typeof saved.layout.sidebar === "number") layout.sidebar = saved.layout.sidebar;
    if (typeof saved.layout.response === "number") layout.response = saved.layout.response;
  }
  const expanded: Record<string, boolean> = {};
  if (isObj(saved.expanded)) for (const id of Object.keys(saved.expanded)) expanded[id] = true;

  const views: SidebarView[] = ["collections", "environments", "history"];
  const history = Array.isArray(historyDoc?.entries)
    ? (historyDoc.entries as HistoryEntry[]).filter((e) => isObj(e) && isObj(e.request)).slice(0, HISTORY_LIMIT)
    : [];

  return {
    problems,
    state: {
      collections,
      environments,
      globals: isRows(globalsDoc?.variables) ? globalsDoc.variables : [],
      history,
      settings: { ...DEFAULT_SETTINGS, ...(isObj(saved.settings) ? (saved.settings as Partial<Settings>) : {}) },
      tabs,
      activeTabId: tabs.some((t) => t.id === saved.activeTabId) ? saved.activeTabId! : (tabs[0]?.id ?? null),
      activeEnvId: environments.some((e) => e.id === saved.activeEnvId) ? saved.activeEnvId! : null,
      expanded,
      sidebarView: views.includes(saved.sidebarView as SidebarView) ? saved.sidebarView! : "collections",
      layout,
    },
  };
}

function json(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function stateDoc(state: AppState): StateDoc {
  return {
    version: 1,
    settings: state.settings,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeEnvId: state.activeEnvId,
    expanded: state.expanded,
    sidebarView: state.sidebarView,
    layout: state.layout,
    collectionOrder: state.collections.map((c) => c.id),
    environmentOrder: state.environments.map((e) => e.id),
  };
}

let flush: () => Promise<void> = async () => undefined;

/** Writes everything that is still waiting to be saved. */
export function flushNow(): Promise<void> {
  return flush();
}

/**
 * Saves documents as they change. Changes are found by comparing references,
 * which immer keeps stable for everything that was not touched.
 */
export function startPersistence(store: StoreApi<AppState>, onError: (message: string) => void): void {
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let lastError = "";

  /** What the document should contain now, or null if it should not exist. */
  const contents = (state: AppState, kind: StoreKind, id: string): string | null => {
    if (kind === "collections") {
      const doc = state.collections.find((c) => c.id === id);
      return doc ? json(doc) : null;
    }
    if (kind === "environments") {
      const doc = state.environments.find((e) => e.id === id);
      return doc ? json(doc) : null;
    }
    if (id === "globals") return json({ variables: state.globals });
    if (id === "history") return json({ entries: state.history });
    return json(stateDoc(state));
  };

  flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const keys = [...dirty];
    dirty.clear();
    chain = chain.then(async () => {
      const state = store.getState();
      for (const key of keys) {
        const slash = key.indexOf("/");
        const kind = key.slice(0, slash) as StoreKind;
        const id = key.slice(slash + 1);
        try {
          const text = contents(state, kind, id);
          if (text === null) await backend.storeDelete(kind, id);
          else await backend.storeWrite(kind, id, text);
          lastError = "";
        } catch (error) {
          const message = `Could not save ${key}.json: ${error instanceof Error ? error.message : String(error)}`;
          if (message !== lastError) onError(message);
          lastError = message;
        }
      }
    });
    return chain;
  };

  const mark = (kind: StoreKind, id: string) => {
    dirty.add(`${kind}/${id}`);
    timer ??= setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  const diff = <T extends { id: string }>(kind: StoreKind, next: T[], prev: T[]) => {
    if (next === prev) return;
    const before = new Map(prev.map((doc) => [doc.id, doc]));
    for (const doc of next) {
      if (before.get(doc.id) !== doc) mark(kind, doc.id);
      before.delete(doc.id);
    }
    for (const id of before.keys()) mark(kind, id);
    mark("app", "state");
  };

  store.subscribe((state, prev) => {
    if (!state.ready || !prev.ready) return;
    diff("collections", state.collections, prev.collections);
    diff("environments", state.environments, prev.environments);
    if (state.globals !== prev.globals) mark("app", "globals");
    if (state.history !== prev.history) mark("app", "history");
    if (
      state.settings !== prev.settings ||
      state.tabs !== prev.tabs ||
      state.activeTabId !== prev.activeTabId ||
      state.activeEnvId !== prev.activeEnvId ||
      state.expanded !== prev.expanded ||
      state.sidebarView !== prev.sidebarView ||
      state.layout !== prev.layout
    ) {
      mark("app", "state");
    }
  });

  backend.onClose(flushNow);
}
