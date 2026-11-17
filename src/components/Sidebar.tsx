import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createContext, useContext, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { formatDuration } from "../lib/format";
import { countRequests } from "../lib/tree";
import type { Collection, Environment, HistoryEntry, Item } from "../model/types";
import { useApp, type ItemRef, type SidebarView } from "../store/app";
import { confirmDelete, exportCollectionFile, exportEnvironmentFile, exportGlobalsFile } from "./actions";
import { MethodBadge } from "./ui/bits";
import { Dropdown, WithContextMenu, type MenuEntry } from "./ui/Menu";

const VIEWS: { id: SidebarView; label: string }[] = [
  { id: "collections", label: "Collections" },
  { id: "environments", label: "Environments" },
  { id: "history", label: "History" },
];

export function Sidebar() {
  const view = useApp((s) => s.sidebarView);
  const setView = useApp((s) => s.setSidebarView);
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div role="tablist" aria-label="Sidebar" className="flex flex-none gap-1 border-b border-line p-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`h-7 min-w-0 flex-auto truncate rounded-md border-0 px-1.5 text-xs font-medium ${
              view === v.id ? "bg-active text-fg" : "bg-transparent text-muted hover:bg-hover hover:text-fg"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "collections" && <CollectionsPanel />}
      {view === "environments" && <EnvironmentsPanel />}
      {view === "history" && <HistoryPanel />}
    </div>
  );
}

/* ---------- Shared pieces ---------- */

function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-9 flex-none items-center gap-0.5 pr-1.5 pl-3">
      <span className="flex-1 truncate text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</span>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-xs leading-relaxed text-muted">{children}</div>;
}

function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = value.trim();
    onDone(commit && name !== "" ? name : null);
  };
  return (
    <input
      autoFocus
      aria-label="Name"
      className="input h-6 flex-1 px-1.5"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
    />
  );
}

function activate(run: () => void) {
  return (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run();
    }
  };
}

function MoreButton({ entries, label }: { entries: MenuEntry[]; label: string }) {
  return (
    <Dropdown entries={entries} align="start">
      <button
        type="button"
        aria-label={label}
        className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontal size={15} />
      </button>
    </Dropdown>
  );
}

/* ---------- Collections ---------- */

type DropPosition = "before" | "after" | "inside";

interface TreeState {
  filter: string;
  renaming: string | null;
  setRenaming(id: string | null): void;
  drop: { id: string; position: DropPosition } | null;
  setDrop(drop: TreeState["drop"]): void;
  activeRequestId: string | null;
}

const TreeContext = createContext<TreeState>(null as unknown as TreeState);

/** The item being dragged; drag events do not expose their data until the drop. */
let dragged: ItemRef | null = null;

function matches(item: Item, filter: string): boolean {
  if (item.name.toLowerCase().includes(filter)) return true;
  if (item.type === "request") return item.request.url.toLowerCase().includes(filter);
  return item.items.some((child) => matches(child, filter));
}

const DROP_CLASS: Record<DropPosition, string> = {
  before: "shadow-[inset_0_2px_0_var(--accent)]",
  after: "shadow-[inset_0_-2px_0_var(--accent)]",
  inside: "bg-accent-soft",
};

function dropPosition(event: DragEvent, container: boolean): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  if (container) return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
  return ratio < 0.5 ? "before" : "after";
}

function CollectionsPanel() {
  const collections = useApp((s) => s.collections);
  const addCollection = useApp((s) => s.addCollection);
  const openDialog = useApp((s) => s.openDialog);
  const activeRequestId = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId)?.source?.requestId ?? null);
  const [filter, setFilter] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<TreeState["drop"]>(null);

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? collections.filter((c) => c.name.toLowerCase().includes(needle) || c.items.some((item) => matches(item, needle)))
    : collections;

  return (
    <TreeContext.Provider value={{ filter: needle, renaming, setRenaming, drop, setDrop, activeRequestId }}>
      <PanelHeader title="Collections">
        <button type="button" className="icon-btn" title="Import" aria-label="Import" onClick={() => openDialog({ type: "import" })}>
          <Upload size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="New collection"
          aria-label="New collection"
          onClick={() => setRenaming(addCollection())}
        >
          <Plus size={16} />
        </button>
      </PanelHeader>
      {collections.length > 0 && (
        <div className="relative mx-2 mb-1.5 flex-none">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            className="input h-7 pr-6 pl-7 text-xs"
            placeholder="Filter"
            aria-label="Filter collections"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              type="button"
              className="icon-btn absolute top-0.5 right-0.5 h-6 w-6"
              aria-label="Clear filter"
              onClick={() => setFilter("")}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-y-auto pb-4"
        onDragEnd={() => {
          dragged = null;
          setDrop(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
      >
        {collections.length === 0 ? (
          <Empty>
            No collections yet.
            <div className="mt-3 flex flex-col items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={() => openDialog({ type: "import" })}>
                <Upload size={13} /> Import from Postman
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenaming(addCollection())}>
                <Plus size={13} /> New collection
              </button>
            </div>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty>Nothing matches “{filter.trim()}”.</Empty>
        ) : (
          visible.map((collection) => <CollectionNode key={collection.id} collection={collection} />)
        )}
      </div>
    </TreeContext.Provider>
  );
}

function CollectionNode({ collection }: { collection: Collection }) {
  const tree = useContext(TreeContext);
  const app = useApp.getState();
  const expanded = useApp((s) => !!s.expanded[collection.id]) || tree.filter !== "";
  const id = collection.id;

  const newRequest = () => {
    const requestId = app.addRequest(id, null);
    if (!requestId) return;
    app.openRequest(id, requestId);
    tree.setRenaming(requestId);
  };
  const entries: MenuEntry[] = [
    { label: "Add request", icon: <FilePlus2 size={14} />, onSelect: newRequest },
    { label: "Add folder", icon: <FolderPlus size={14} />, onSelect: () => tree.setRenaming(app.addFolder(id, null)) },
    "separator",
    {
      label: "Edit auth & variables",
      icon: <Settings2 size={14} />,
      onSelect: () => app.openDialog({ type: "collection", collectionId: id, folderId: null }),
    },
    { label: "Rename", icon: <Pencil size={14} />, onSelect: () => tree.setRenaming(id) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => app.duplicateCollection(id) },
    { label: "Export", icon: <Download size={14} />, onSelect: () => void exportCollectionFile(collection) },
    "separator",
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () =>
        confirmDelete(
          `“${collection.name}”`,
          `The collection and its ${countRequests(collection.items)} request(s) will be deleted from this computer.`,
          () => app.deleteCollection(id),
        ),
    },
  ];

  const filter = tree.filter;
  const showAll = filter === "" || collection.name.toLowerCase().includes(filter);
  const children = showAll ? collection.items : collection.items.filter((item) => matches(item, filter));
  const toggle = () => app.toggleExpanded(id);

  return (
    <div>
      <WithContextMenu entries={entries}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          className={`group flex h-7 items-center gap-1 pr-1 pl-1.5 hover:bg-hover ${
            tree.drop?.id === id ? DROP_CLASS.inside : ""
          }`}
          onClick={toggle}
          onKeyDown={activate(toggle)}
          onDragOver={(e) => {
            if (!dragged) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (tree.drop?.id !== id) tree.setDrop({ id, position: "inside" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            tree.setDrop(null);
            if (dragged) app.moveItem(dragged, { collectionId: id, parentId: null, index: collection.items.length });
            dragged = null;
          }}
        >
          <span className="flex w-4 flex-none justify-center text-muted">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          {tree.renaming === id ? (
            <RenameInput
              initial={collection.name}
              onDone={(name) => {
                tree.setRenaming(null);
                if (name) app.updateCollection(id, (c) => void (c.name = name));
              }}
            />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate font-semibold" title={collection.name}>
                {collection.name}
              </span>
              <MoreButton entries={entries} label={`Actions for ${collection.name}`} />
            </>
          )}
        </div>
      </WithContextMenu>
      {expanded &&
        (children.length === 0 ? (
          <div className="py-1 pr-2 pl-7 text-xs text-faint">
            Empty.{" "}
            <button type="button" className="border-0 bg-transparent p-0 text-accent hover:underline" onClick={newRequest}>
              Add a request
            </button>
          </div>
        ) : (
          children.map((item) => (
            <ItemNode
              key={item.id}
              collectionId={id}
              parentId={null}
              index={collection.items.indexOf(item)}
              item={item}
              depth={1}
              forceShow={showAll}
            />
          ))
        ))}
    </div>
  );
}

interface ItemNodeProps {
  collectionId: string;
  parentId: string | null;
  index: number;
  item: Item;
  depth: number;
  /** An ancestor matched the filter, so everything below it is shown. */
  forceShow: boolean;
}

function ItemNode({ collectionId, parentId, index, item, depth, forceShow }: ItemNodeProps) {
  const tree = useContext(TreeContext);
  const app = useApp.getState();
  const isFolder = item.type === "folder";
  const expanded = useApp((s) => !!s.expanded[item.id]) || tree.filter !== "";
  const ref: ItemRef = { collectionId, itemId: item.id };

  const open = () => (isFolder ? app.toggleExpanded(item.id) : app.openRequest(collectionId, item.id));
  const rename = { label: "Rename", icon: <Pencil size={14} />, onSelect: () => tree.setRenaming(item.id) };
  const duplicate = { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => app.duplicateItem(ref) };
  const newRequest = () => {
    const requestId = app.addRequest(collectionId, item.id);
    if (!requestId) return;
    app.openRequest(collectionId, requestId);
    tree.setRenaming(requestId);
  };

  const entries: MenuEntry[] = isFolder
    ? [
        { label: "Add request", icon: <FilePlus2 size={14} />, onSelect: newRequest },
        {
          label: "Add folder",
          icon: <FolderPlus size={14} />,
          onSelect: () => tree.setRenaming(app.addFolder(collectionId, item.id)),
        },
        "separator",
        {
          label: "Edit auth",
          icon: <Settings2 size={14} />,
          onSelect: () => app.openDialog({ type: "collection", collectionId, folderId: item.id }),
        },
        rename,
        duplicate,
        "separator",
        {
          label: "Delete",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () =>
            confirmDelete(
              `“${item.name}”`,
              `The folder and its ${countRequests(item.items)} request(s) will be deleted.`,
              () => app.deleteItem(ref),
            ),
        },
      ]
    : [
        rename,
        duplicate,
        "separator",
        {
          label: "Delete",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => confirmDelete(`“${item.name}”`, "The request will be deleted.", () => app.deleteItem(ref)),
        },
      ];

  const filter = tree.filter;
  const showAll = forceShow || filter === "" || item.name.toLowerCase().includes(filter);
  const children = isFolder ? (showAll ? item.items : item.items.filter((child) => matches(child, filter))) : [];
  const selected = !isFolder && tree.activeRequestId === item.id;
  const hint = tree.drop?.id === item.id ? DROP_CLASS[tree.drop.position] : "";

  return (
    <div>
      <WithContextMenu entries={entries}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isFolder ? expanded : undefined}
          aria-current={selected ? "true" : undefined}
          draggable={tree.renaming !== item.id && filter === ""}
          className={`group flex h-7 items-center gap-1.5 pr-1 ${selected ? "bg-active" : "hover:bg-hover"} ${hint}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={open}
          onKeyDown={activate(open)}
          onDragStart={(e) => {
            dragged = ref;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", item.name);
          }}
          onDragOver={(e) => {
            if (!dragged || dragged.itemId === item.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const position = dropPosition(e, isFolder);
            if (tree.drop?.id !== item.id || tree.drop.position !== position) tree.setDrop({ id: item.id, position });
          }}
          onDrop={(e) => {
            e.preventDefault();
            tree.setDrop(null);
            if (!dragged || dragged.itemId === item.id) return;
            const position = dropPosition(e, isFolder);
            if (position === "inside" && item.type === "folder") {
              app.moveItem(dragged, { collectionId, parentId: item.id, index: item.items.length });
            } else {
              app.moveItem(dragged, { collectionId, parentId, index: position === "before" ? index : index + 1 });
            }
            dragged = null;
          }}
        >
          {isFolder ? (
            <>
              <span className="flex w-4 flex-none justify-center text-muted">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span className="flex-none text-muted">{expanded ? <FolderOpen size={14} /> : <Folder size={14} />}</span>
            </>
          ) : (
            <MethodBadge method={item.request.method} className="w-9 text-right" />
          )}
          {tree.renaming === item.id ? (
            <RenameInput
              initial={item.name}
              onDone={(name) => {
                tree.setRenaming(null);
                if (name) app.updateItem(ref, (target) => void (target.name = name));
              }}
            />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              <MoreButton entries={entries} label={`Actions for ${item.name}`} />
            </>
          )}
        </div>
      </WithContextMenu>
      {isFolder &&
        expanded &&
        children.map((child) => (
          <ItemNode
            key={child.id}
            collectionId={collectionId}
            parentId={item.id}
            index={item.items.indexOf(child)}
            item={child}
            depth={depth + 1}
            forceShow={showAll && filter !== ""}
          />
        ))}
    </div>
  );
}

/* ---------- Environments ---------- */

function EnvironmentsPanel() {
  const environments = useApp((s) => s.environments);
  const globals = useApp((s) => s.globals);
  const activeEnvId = useApp((s) => s.activeEnvId);
  const app = useApp.getState();

  const add = () => {
    const id = app.addEnvironment();
    app.openDialog({ type: "variables", target: { kind: "environment", id } });
  };
  const globalsEntries: MenuEntry[] = [
    { label: "Edit", icon: <Pencil size={14} />, onSelect: () => app.openDialog({ type: "variables", target: { kind: "globals" } }) },
    { label: "Export", icon: <Download size={14} />, onSelect: () => void exportGlobalsFile(globals) },
  ];

  return (
    <>
      <PanelHeader title="Environments">
        <button type="button" className="icon-btn" title="Import" aria-label="Import" onClick={() => app.openDialog({ type: "import" })}>
          <Upload size={15} />
        </button>
        <button type="button" className="icon-btn" title="New environment" aria-label="New environment" onClick={add}>
          <Plus size={16} />
        </button>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <WithContextMenu entries={globalsEntries}>
          <div
            role="button"
            tabIndex={0}
            className="group flex h-8 items-center gap-2 pr-1 pl-3 hover:bg-hover"
            onClick={globalsEntries[0] !== "separator" ? globalsEntries[0]!.onSelect : undefined}
            onKeyDown={activate(() => app.openDialog({ type: "variables", target: { kind: "globals" } }))}
          >
            <Globe size={14} className="flex-none text-muted" />
            <span className="min-w-0 flex-1 truncate">Globals</span>
            <span className="text-xs text-faint group-hover:hidden">{globals.length}</span>
            <MoreButton entries={globalsEntries} label="Actions for Globals" />
          </div>
        </WithContextMenu>
        <div className="mx-3 my-1 h-px bg-line" />
        {environments.length === 0 && (
          <Empty>
            An environment is a set of variables, such as a base URL and a token for “staging”. Use them in requests as{" "}
            <code className="font-mono text-[var(--var-ok)]">{"{{name}}"}</code>.
            <div className="mt-3">
              <button type="button" className="btn btn-sm" onClick={add}>
                <Plus size={13} /> New environment
              </button>
            </div>
          </Empty>
        )}
        {environments.map((environment) => (
          <EnvironmentRow key={environment.id} environment={environment} active={environment.id === activeEnvId} />
        ))}
      </div>
    </>
  );
}

function EnvironmentRow({ environment, active }: { environment: Environment; active: boolean }) {
  const app = useApp.getState();
  const id = environment.id;
  const edit = () => app.openDialog({ type: "variables", target: { kind: "environment", id } });
  const entries: MenuEntry[] = [
    { label: "Edit", icon: <Pencil size={14} />, onSelect: edit },
    active
      ? { label: "Deactivate", icon: <X size={14} />, onSelect: () => app.setActiveEnv(null) }
      : { label: "Set active", icon: <Check size={14} />, onSelect: () => app.setActiveEnv(id) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: () => app.duplicateEnvironment(id) },
    { label: "Export", icon: <Download size={14} />, onSelect: () => void exportEnvironmentFile(environment) },
    "separator",
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () =>
        confirmDelete(`“${environment.name}”`, "The environment and its variables will be deleted.", () =>
          app.deleteEnvironment(id),
        ),
    },
  ];
  return (
    <WithContextMenu entries={entries}>
      <div
        role="button"
        tabIndex={0}
        className="group flex h-8 items-center gap-2 pr-1 pl-3 hover:bg-hover"
        onClick={edit}
        onKeyDown={activate(edit)}
      >
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={`Use ${environment.name}`}
          title={active ? "Active environment" : "Set active"}
          className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border p-0 ${
            active ? "border-accent bg-accent text-accent-fg" : "border-faint bg-transparent text-transparent hover:border-accent"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            app.setActiveEnv(active ? null : id);
          }}
        >
          <Check size={11} strokeWidth={3} />
        </button>
        <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : ""}`} title={environment.name}>
          {environment.name}
        </span>
        <span className="text-xs text-faint group-hover:hidden">{environment.variables.length}</span>
        <MoreButton entries={entries} label={`Actions for ${environment.name}`} />
      </div>
    </WithContextMenu>
  );
}

/* ---------- History ---------- */

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

function HistoryPanel() {
  const history = useApp((s) => s.history);
  const app = useApp.getState();

  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const entry of history) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return (
    <>
      <PanelHeader title="History">
        <button
          type="button"
          className="icon-btn"
          title="Clear history"
          aria-label="Clear history"
          disabled={history.length === 0}
          onClick={() =>
            confirmDelete("all history", `${history.length} entr${history.length === 1 ? "y" : "ies"} will be removed.`, () =>
              app.clearHistory(),
            )
          }
        >
          <Trash2 size={14} />
        </button>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {history.length === 0 && <Empty>Requests you send show up here, newest first.</Empty>}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-faint">{group.label}</div>
            {group.entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const app = useApp.getState();
  const open = () => app.openHistory(entry);
  const failed = entry.error !== undefined;
  const statusColor = failed || (entry.status ?? 0) >= 400 ? "text-danger" : (entry.status ?? 0) >= 300 ? "text-warn" : "text-ok";
  const time = new Date(entry.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex items-center gap-2 py-1 pr-1 pl-3 hover:bg-hover"
      title={`${entry.request.method} ${entry.resolvedUrl}${entry.error ? `\n${entry.error}` : ""}`}
      onClick={open}
      onKeyDown={activate(open)}
    >
      <MethodBadge method={entry.request.method} className="w-9 text-right" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{entry.resolvedUrl.replace(/^https?:\/\//, "") || entry.name}</div>
        <div className="flex gap-2 text-[11px] text-faint">
          <span className={statusColor}>{failed ? "Error" : entry.status}</span>
          {entry.timeMs !== undefined && <span>{formatDuration(entry.timeMs)}</span>}
          <span>{time}</span>
        </div>
      </div>
      <button
        type="button"
        className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Remove from history"
        onClick={(e) => {
          e.stopPropagation();
          app.deleteHistory(entry.id);
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
