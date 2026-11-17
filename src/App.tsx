import { Download, Plus, Settings as SettingsIcon, SlidersHorizontal } from "lucide-react";
import { useEffect } from "react";
import { Dialogs } from "./components/dialogs/Dialogs";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/ui/bits";
import { Split } from "./components/ui/Split";
import { useScopeVars, VarsContext } from "./components/vars";
import { useApp } from "./store/app";

/** Applies the light or dark palette, following the system while the setting says so. */
function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const app = useApp.getState();
      if (app.dialog) return;
      const tabId = app.activeTabId;
      switch (event.key.toLowerCase()) {
        case "enter":
          if (tabId) void app.send(tabId);
          break;
        case "s":
          if (tabId) app.saveTab(tabId);
          break;
        case "t":
          app.newTab();
          break;
        case "w":
          if (tabId) app.requestCloseTab(tabId);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function TopBar() {
  const app = useApp.getState();
  const environments = useApp((s) => s.environments);
  const activeEnvId = useApp((s) => s.activeEnvId);
  const active = environments.find((e) => e.id === activeEnvId);

  return (
    <header className="flex h-11 flex-none items-center gap-2 border-b border-line bg-panel px-3">
      <span className="mr-2 text-sm font-semibold tracking-tight">zman</span>
      <button type="button" className="btn btn-sm" onClick={() => app.newTab()}>
        <Plus size={14} /> New
      </button>
      <button type="button" className="btn btn-sm" onClick={() => app.openDialog({ type: "import" })}>
        <Download size={14} /> Import
      </button>
      <div className="flex-1" />
      <select
        className="input h-7 w-52 py-0 text-xs"
        aria-label="Active environment"
        value={active?.id ?? ""}
        onChange={(e) => app.setActiveEnv(e.target.value || null)}
      >
        <option value="">No environment</option>
        {environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {environment.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-btn"
        title={active ? `Edit the variables of ${active.name}` : "Edit global variables"}
        aria-label={active ? "Edit environment variables" : "Edit global variables"}
        onClick={() =>
          app.openDialog({ type: "variables", target: active ? { kind: "environment", id: active.id } : { kind: "globals" } })
        }
      >
        <SlidersHorizontal size={16} />
      </button>
      <button type="button" className="icon-btn" title="Settings" aria-label="Settings" onClick={() => app.openDialog({ type: "settings" })}>
        <SettingsIcon size={16} />
      </button>
    </header>
  );
}

function Workspace() {
  const app = useApp.getState();
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const response = useApp((s) => s.layout.response);
  const vars = useScopeVars(tab?.source?.collectionId);

  if (!tab) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="text-muted">No request is open.</div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => app.newTab()}>
            <Plus size={14} /> New request
          </button>
          <button type="button" className="btn" onClick={() => app.openDialog({ type: "import" })}>
            <Download size={14} /> Import from Postman
          </button>
        </div>
      </div>
    );
  }

  return (
    <VarsContext.Provider value={vars}>
      <Split direction="column" fixed="second" unit="fraction" size={response} min={0.15} max={0.8} onResize={(size) => app.setLayout({ response: size })}>
        <RequestEditor key={tab.id} tabId={tab.id} />
        <ResponseViewer key={tab.id} tabId={tab.id} />
      </Split>
    </VarsContext.Provider>
  );
}

export function App() {
  const ready = useApp((s) => s.ready);
  const sidebar = useApp((s) => s.layout.sidebar);
  useTheme();
  useShortcuts();

  if (!ready) return null;

  return (
    <div className="flex h-full flex-col bg-surface text-fg">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Split direction="row" fixed="first" unit="px" size={sidebar} min={200} max={600} onResize={(size) => useApp.getState().setLayout({ sidebar: size })}>
          <Sidebar />
          <div className="flex h-full min-w-0 flex-col">
            <TabBar />
            <div className="flex min-h-0 flex-1 flex-col">
              <Workspace />
            </div>
          </div>
        </Split>
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}
