import { useEffect, useState, type ReactNode } from "react";
import { backend } from "../../backend";
import type { ProxySetting, Settings } from "../../model/types";
import { useApp } from "../../store/app";
import { copyText } from "../ui/bits";
import { Modal } from "../ui/Modal";

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="flex flex-none items-center">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(checked: boolean): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative h-5 w-9 rounded-full border-0 p-0 transition-colors ${checked ? "bg-accent" : "bg-active"}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

export function SettingsDialog() {
  const settings = useApp((s) => s.settings);
  const app = useApp.getState();
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [timeoutText, setTimeoutText] = useState(() => (settings.timeoutMs === 0 ? "" : String(settings.timeoutMs / 1000)));

  useEffect(() => {
    let alive = true;
    backend.appInfo().then(
      (value) => alive && setInfo(value),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const set = (patch: Partial<Settings>) => app.updateSettings(patch);
  const proxyUrl = settings.proxy.mode === "custom" ? settings.proxy.url : "";

  return (
    <Modal
      title="Settings"
      onClose={app.closeDialog}
      width={600}
      footer={
        <button type="button" className="btn btn-primary" onClick={app.closeDialog}>
          Done
        </button>
      }
    >
      <div className="-my-3">
        <Row title="Theme">
          <select className="input w-40" aria-label="Theme" value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>

        <Row title="Request timeout" hint="Seconds to wait for a response. Leave empty to wait without a limit.">
          <input
            className="input w-24 text-right"
            aria-label="Request timeout in seconds"
            inputMode="decimal"
            placeholder="No limit"
            value={timeoutText}
            onChange={(e) => {
              const text = e.target.value.replace(/[^0-9.]/g, "");
              setTimeoutText(text);
              const seconds = Number(text);
              set({ timeoutMs: text !== "" && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0 });
            }}
          />
          <span className="ml-2 text-xs text-muted">s</span>
        </Row>

        <Row title="Follow redirects" hint="Follow 3xx responses automatically, up to 10 in a row.">
          <Toggle label="Follow redirects" checked={settings.followRedirects} onChange={(followRedirects) => set({ followRedirects })} />
        </Row>

        <Row
          title="Verify SSL certificates"
          hint="Turn off to talk to servers with self-signed or expired certificates. Leave on for anything you do not control."
        >
          <Toggle label="Verify SSL certificates" checked={settings.verifySsl} onChange={(verifySsl) => set({ verifySsl })} />
        </Row>

        <Row
          title="Proxy"
          hint={
            settings.proxy.mode === "system"
              ? "Uses the HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables, if set."
              : settings.proxy.mode === "none"
                ? "Requests always go straight to the server."
                : "For example http://127.0.0.1:8080 or socks5://127.0.0.1:1080."
          }
        >
          <div className="flex flex-col items-end gap-2">
            <select
              className="input w-40"
              aria-label="Proxy"
              value={settings.proxy.mode}
              onChange={(e) => {
                const mode = e.target.value as ProxySetting["mode"];
                set({ proxy: mode === "custom" ? { mode, url: proxyUrl } : { mode } });
              }}
            >
              <option value="system">System</option>
              <option value="none">No proxy</option>
              <option value="custom">Custom</option>
            </select>
            {settings.proxy.mode === "custom" && (
              <input
                className="input w-64 font-mono text-xs"
                aria-label="Proxy URL"
                placeholder="http://host:port"
                spellCheck={false}
                value={proxyUrl}
                onChange={(e) => set({ proxy: { mode: "custom", url: e.target.value } })}
              />
            )}
          </div>
        </Row>

        <Row title="Cookies" hint="Cookies set by servers are kept in memory until the app is closed, and sent back to the same site.">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                await backend.clearCookies();
                app.toast("Cookies cleared.", "success");
              } catch (error) {
                app.toast(`Could not clear cookies: ${String(error)}`, "error");
              }
            }}
          >
            Clear cookies
          </button>
        </Row>

        <Row
          title="Your data"
          hint="Collections, environments and history are JSON files in this folder. Nothing is sent anywhere: the only network traffic is the requests you send."
        >
          <span />
        </Row>
        <div className="-mt-1 flex items-center gap-2 pb-3">
          <code className="selectable min-w-0 flex-1 truncate rounded-md bg-panel px-2 py-1.5 font-mono text-xs" title={info?.dataDir}>
            {info?.dataDir ?? "…"}
          </code>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!info}
            onClick={async () => {
              if (info && (await copyText(info.dataDir))) app.toast("Copied the folder path.", "success");
            }}
          >
            Copy path
          </button>
        </div>
        <div className="pb-3 text-xs text-faint">zman {info?.version ?? ""}</div>
      </div>
    </Modal>
  );
}
