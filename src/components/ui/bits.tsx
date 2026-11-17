import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useApp, type Toast } from "../../store/app";

const METHOD_COLORS: Record<string, string> = {
  GET: "var(--m-get)",
  POST: "var(--m-post)",
  PUT: "var(--m-put)",
  PATCH: "var(--m-patch)",
  DELETE: "var(--m-delete)",
};

const METHOD_SHORT: Record<string, string> = { DELETE: "DEL", OPTIONS: "OPT", PATCH: "PATCH" };

export function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? "var(--m-other)";
}

export function MethodBadge({ method, className = "" }: { method: string; className?: string }) {
  const upper = method.toUpperCase();
  return (
    <span
      className={`flex-none text-[10px] leading-none font-bold tracking-wide ${className}`}
      style={{ color: methodColor(upper) }}
    >
      {METHOD_SHORT[upper] ?? upper.slice(0, 6)}
    </span>
  );
}

export interface TabOption<T extends string> {
  id: T;
  label: string;
  /** A count, or true for a plain dot. */
  badge?: number | boolean;
}

interface TabStripProps<T extends string> {
  tabs: TabOption<T>[];
  active: T;
  onSelect(id: T): void;
  /** Controls placed at the right end of the strip. */
  children?: ReactNode;
  label: string;
}

export function TabStrip<T extends string>({ tabs, active, onSelect, children, label }: TabStripProps<T>) {
  return (
    <div className="flex flex-none items-center border-b border-line px-2">
      <div role="tablist" aria-label={label} className="flex items-center">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            onClick={() => onSelect(tab.id)}
            className={`-mb-px flex h-8 items-center gap-1.5 border-b-2 bg-transparent px-2.5 text-[13px] ${
              tab.id === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 && <span className="text-[11px] text-ok">({tab.badge})</span>}
            {tab.badge === true && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      {children}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useApp((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.kind === "error" ? 9000 : 3500);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, dismiss]);

  const icon =
    toast.kind === "error" ? (
      <AlertCircle size={16} className="text-danger" />
    ) : toast.kind === "success" ? (
      <CheckCircle2 size={16} className="text-ok" />
    ) : (
      <Info size={16} className="text-accent" />
    );
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className="flex w-80 items-start gap-2 rounded-lg border border-line bg-surface py-2 pr-1.5 pl-3 shadow-[var(--shadow)]"
    >
      <span className="mt-0.5 flex-none">{icon}</span>
      <span className="selectable min-w-0 flex-1 py-0.5 break-words">{toast.message}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[70] flex flex-col gap-2 [&>*]:pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

/** Copies text, falling back for webviews without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
