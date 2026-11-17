import { Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { isTabDirty, tabTitle, useApp, type Tab } from "../store/app";
import { MethodBadge } from "./ui/bits";
import { WithContextMenu, type MenuEntry } from "./ui/Menu";

/** Closes the given tabs, keeping (and reporting) the ones with unsaved changes. */
function closeMany(ids: string[]) {
  const app = useApp.getState();
  let kept = 0;
  for (const id of ids) {
    const tab = useApp.getState().tabs.find((t) => t.id === id);
    if (!tab) continue;
    if (isTabDirty(useApp.getState(), tab)) kept++;
    else app.closeTab(id);
  }
  if (kept > 0) app.toast(`${kept} tab${kept === 1 ? "" : "s"} with unsaved changes kept open.`);
}

export function TabBar() {
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const newTab = useApp((s) => s.newTab);
  return (
    <div className="flex h-9 flex-none items-stretch border-b border-line bg-panel">
      <div role="tablist" aria-label="Open requests" className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={tab.id === activeTabId} />
        ))}
      </div>
      <button type="button" className="icon-btn m-1.5 flex-none" title="New tab (Ctrl+T)" aria-label="New tab" onClick={() => newTab()}>
        <Plus size={16} />
      </button>
    </div>
  );
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const title = useApp((s) => tabTitle(s, tab));
  const dirty = useApp((s) => isTabDirty(s, tab));
  const sending = useApp((s) => s.runtime[tab.id]?.sending ?? false);
  const app = useApp.getState();
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) element.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const others = () => useApp.getState().tabs.filter((t) => t.id !== tab.id).map((t) => t.id);
  const entries: MenuEntry[] = [
    { label: "Close", onSelect: () => app.requestCloseTab(tab.id) },
    { label: "Close others", onSelect: () => closeMany(others()) },
    { label: "Close all", onSelect: () => closeMany(useApp.getState().tabs.map((t) => t.id)) },
  ];

  return (
    <WithContextMenu entries={entries}>
      <div
        ref={element}
        role="tab"
        tabIndex={0}
        aria-selected={active}
        title={title}
        className={`group flex max-w-52 min-w-28 flex-none items-center gap-1.5 border-r border-line pr-1 pl-2.5 ${
          active ? "bg-surface shadow-[inset_0_2px_0_var(--accent)]" : "text-muted hover:bg-hover"
        }`}
        onClick={() => app.setActiveTab(tab.id)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            app.setActiveTab(tab.id);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            app.requestCloseTab(tab.id);
          }
        }}
      >
        <MethodBadge method={tab.draft.method} />
        <span className={`min-w-0 flex-1 truncate ${sending ? "italic" : ""}`}>{title}</span>
        <button
          type="button"
          className="icon-btn relative h-5 w-5"
          aria-label={`Close ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            app.requestCloseTab(tab.id);
          }}
        >
          {dirty && <span className="absolute h-2 w-2 rounded-full bg-warn group-hover:hidden" title="Unsaved changes" />}
          <X size={13} className={dirty ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100"} />
        </button>
      </div>
    </WithContextMenu>
  );
}
