import { AlertTriangle, Copy, Download, FileQuestion, Loader2, SendHorizontal, WrapText, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { backend } from "../backend";
import {
  contentKind,
  formatBytes,
  formatDuration,
  headerValue,
  parseSetCookies,
  prettyJson,
  statusClass,
  type ContentKind,
} from "../lib/format";
import type { HttpError, HttpResponseData } from "../model/types";
import { IDLE, useApp } from "../store/app";
import { copyText, TabStrip, type TabOption } from "./ui/bits";
import { CodeEditor, type CodeLanguage } from "./ui/CodeEditor";

type Section = "body" | "headers" | "cookies";
type BodyView = "pretty" | "raw" | "preview";

const STATUS_COLOR: Record<ReturnType<typeof statusClass>, string> = {
  ok: "text-ok",
  info: "text-muted",
  redirect: "text-warn",
  client: "text-danger",
  server: "text-danger",
};

const ERROR_TITLE: Record<HttpError["kind"], string> = {
  cancelled: "Request cancelled",
  timeout: "The request timed out",
  connect: "Could not connect",
  tls: "TLS / certificate problem",
  invalidRequest: "The request is not valid",
  file: "Could not read a file",
  tooLarge: "The response is too large",
  other: "Could not send the request",
};

/** The part of an error message that says more than the title above it. */
function errorDetail(kind: HttpError["kind"], message: string): string {
  if (kind === "cancelled") return "";
  const title = ERROR_TITLE[kind].toLowerCase();
  const text = message.trim();
  if (!text.toLowerCase().startsWith(title)) return text;
  return text.slice(title.length).replace(/^[\s:.]+/, "");
}

const EXTENSION: Record<ContentKind, string> = {
  json: ".json",
  xml: ".xml",
  html: ".html",
  javascript: ".js",
  image: "",
  text: ".txt",
  binary: "",
};

/** Blocks scripts and every network load inside the HTML preview. */
const PREVIEW_CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">";

function fileNameFor(response: HttpResponseData, kind: ContentKind): string {
  let base = "response";
  try {
    const last = new URL(response.finalUrl).pathname.split("/").filter(Boolean).pop();
    if (last) base = decodeURIComponent(last).replace(/[^\w.-]+/g, "_") || base;
  } catch {
    // Keep the default name.
  }
  return /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : base + EXTENSION[kind];
}

function Elapsed() {
  const [start] = useState(() => performance.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <>{((now - start) / 1000).toFixed(1)} s</>;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">{children}</div>;
}

export function ResponseViewer({ tabId }: { tabId: string }) {
  const runtime = useApp((s) => s.runtime[tabId] ?? IDLE);
  const app = useApp.getState();
  const { response, error, sending, warnings } = runtime;

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-line">
      {warnings.length > 0 && (
        <div className="flex flex-none items-start gap-2 border-b border-line bg-warn-soft px-3 py-1.5 text-xs">
          <AlertTriangle size={14} className="mt-px flex-none text-warn" />
          <div className="selectable min-w-0 flex-1">
            {warnings.map((warning, index) => (
              <div key={index}>{warning}</div>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {sending ? (
          <Centered>
            <Loader2 size={22} className="spin text-accent" />
            <div>
              Sending request… <Elapsed />
            </div>
            <button type="button" className="btn btn-sm mt-1" onClick={() => app.cancel(tabId)}>
              Cancel
            </button>
          </Centered>
        ) : error ? (
          <Centered>
            {error.kind === "cancelled" ? <XCircle size={26} className="text-faint" /> : <XCircle size={26} className="text-danger" />}
            <div className="text-sm font-semibold text-fg">{ERROR_TITLE[error.kind]}</div>
            {errorDetail(error.kind, error.message) && (
              <div className="selectable max-w-xl font-mono text-xs leading-relaxed break-words">{errorDetail(error.kind, error.message)}</div>
            )}
            {error.kind === "tls" && (
              <button type="button" className="btn btn-sm mt-1" onClick={() => app.openDialog({ type: "settings" })}>
                Open settings to turn off SSL verification
              </button>
            )}
            {error.kind === "timeout" && (
              <button type="button" className="btn btn-sm mt-1" onClick={() => app.openDialog({ type: "settings" })}>
                Change the timeout in settings
              </button>
            )}
            {!backend.native && error.kind !== "cancelled" && (
              <div className="max-w-md text-xs text-faint">
                You are running in a browser, where requests are limited by CORS. The desktop app does not have this limit.
              </div>
            )}
          </Centered>
        ) : response ? (
          <ResponseContent response={response} />
        ) : (
          <Centered>
            <SendHorizontal size={26} className="text-faint" />
            <div>Send the request to see the response here.</div>
            <div className="text-xs text-faint">Ctrl+Enter sends from anywhere in the tab.</div>
          </Centered>
        )}
      </div>
    </div>
  );
}

function ResponseContent({ response }: { response: HttpResponseData }) {
  const toast = useApp((s) => s.toast);
  const [section, setSection] = useState<Section>("body");
  const [view, setView] = useState<BodyView>("pretty");
  const [wrap, setWrap] = useState(true);

  const contentType = headerValue(response.headers, "content-type");
  const kind = contentKind(contentType, response.body.kind === "text");
  const text = response.body.kind === "text" ? response.body.text : null;
  const cookies = useMemo(() => parseSetCookies(response.headers), [response.headers]);
  const pretty = useMemo(() => (kind === "json" && text !== null ? prettyJson(text) : null), [kind, text]);

  const canPreview = kind === "html" || kind === "image";
  const views: BodyView[] = text !== null ? (canPreview ? ["pretty", "raw", "preview"] : ["pretty", "raw"]) : [];
  const shown: BodyView = kind === "image" ? "preview" : views.includes(view) ? view : "pretty";
  const language: CodeLanguage = kind === "image" || kind === "binary" ? "text" : kind;

  const sections: TabOption<Section>[] = [
    { id: "body", label: "Body" },
    { id: "headers", label: "Headers", badge: response.headers.length },
    { id: "cookies", label: "Cookies", badge: cookies.length },
  ];

  const save = async () => {
    try {
      const path = await backend.saveResponseBody(fileNameFor(response, kind), response.body);
      if (path) toast(`Saved to ${path}`, "success");
    } catch (error) {
      toast(`Could not save the response: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip label="Response sections" tabs={sections} active={section} onSelect={(id) => setSection(id)}>
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-semibold ${STATUS_COLOR[statusClass(response.status)]}`} title={response.httpVersion}>
            {response.status} {response.statusText}
          </span>
          <span className="text-muted" title="Time until the whole response was received">
            {formatDuration(response.timeMs)}
          </span>
          <span className="text-muted" title="Size of the response body">
            {formatBytes(response.sizeBytes)}
          </span>
          <span className="flex items-center">
            {text !== null && (
              <button
                type="button"
                className="icon-btn"
                title="Copy body"
                aria-label="Copy body"
                onClick={async () => {
                  const ok = await copyText(shown === "pretty" && pretty !== null ? pretty : text);
                  toast(ok ? "Copied the response body." : "Could not copy to the clipboard.", ok ? "success" : "error");
                }}
              >
                <Copy size={14} />
              </button>
            )}
            <button type="button" className="icon-btn" title="Save to file" aria-label="Save response to file" onClick={() => void save()}>
              <Download size={14} />
            </button>
          </span>
        </div>
      </TabStrip>

      {section === "body" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {views.length > 0 && (
            <div className="flex flex-none items-center gap-1 px-2 py-1">
              <div role="radiogroup" aria-label="Body view" className="flex rounded-md bg-panel p-0.5">
                {views.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={shown === option}
                    className={`h-6 rounded border-0 px-2.5 text-xs capitalize ${
                      shown === option ? "bg-surface font-medium text-fg shadow-sm" : "bg-transparent text-muted hover:text-fg"
                    }`}
                    onClick={() => setView(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <span className="ml-1 text-xs text-faint">{contentType?.split(";")[0] ?? "no content type"}</span>
              <span className="flex-1" />
              {shown !== "preview" && (
                <button
                  type="button"
                  className={`icon-btn ${wrap ? "bg-active text-fg" : ""}`}
                  title="Wrap long lines"
                  aria-label="Wrap long lines"
                  aria-pressed={wrap}
                  onClick={() => setWrap(!wrap)}
                >
                  <WrapText size={14} />
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 border-t border-line">
            {response.sizeBytes === 0 ? (
              <Centered>
                <div className="text-xs">The response has no body.</div>
              </Centered>
            ) : kind === "image" && contentType ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <img
                  alt="Response"
                  className="max-h-full max-w-full object-contain"
                  src={
                    response.body.kind === "base64"
                      ? `data:${contentType.split(";")[0]};base64,${response.body.data}`
                      : `data:${contentType.split(";")[0]},${encodeURIComponent(response.body.text)}`
                  }
                />
              </div>
            ) : text === null ? (
              <Centered>
                <FileQuestion size={26} className="text-faint" />
                <div>
                  Binary response ({formatBytes(response.sizeBytes)}
                  {contentType ? `, ${contentType.split(";")[0]}` : ""}) cannot be shown as text.
                </div>
                <button type="button" className="btn btn-sm mt-1" onClick={() => void save()}>
                  <Download size={13} /> Save to file
                </button>
              </Centered>
            ) : shown === "preview" ? (
              <iframe title="Response preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={PREVIEW_CSP + text} />
            ) : (
              <CodeEditor
                ariaLabel="Response body"
                readOnly
                wrap={wrap}
                language={shown === "pretty" ? language : "text"}
                value={shown === "pretty" && pretty !== null ? pretty : text}
              />
            )}
          </div>
        </div>
      )}

      {section === "headers" && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="selectable w-full border-collapse text-[12.5px]">
            <tbody>
              {response.headers.map(([name, value], index) => (
                <tr key={index} className="border-b border-line align-top">
                  <th scope="row" className="w-1/3 py-1.5 pr-3 text-left font-medium text-muted">
                    {name}
                  </th>
                  <td className="py-1.5 font-mono break-all">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === "cookies" && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {cookies.length === 0 ? (
            <p className="m-0 text-xs text-muted">The response did not set any cookies.</p>
          ) : (
            <table className="selectable w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  {["Name", "Value", "Domain", "Path", "Expires", "Flags"].map((heading) => (
                    <th key={heading} className="py-1.5 pr-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cookies.map((cookie, index) => (
                  <tr key={index} className="border-b border-line align-top">
                    <td className="py-1.5 pr-3 font-medium">{cookie.name}</td>
                    <td className="py-1.5 pr-3 font-mono break-all">{cookie.value}</td>
                    <td className="py-1.5 pr-3">{cookie.attributes.domain ?? ""}</td>
                    <td className="py-1.5 pr-3">{cookie.attributes.path ?? ""}</td>
                    <td className="py-1.5 pr-3">{cookie.attributes.expires ?? cookie.attributes["max-age"] ?? "Session"}</td>
                    <td className="py-1.5">
                      {["secure", "httponly", "samesite"]
                        .filter((flag) => cookie.attributes[flag] !== undefined)
                        .map((flag) => (flag === "samesite" ? `SameSite=${cookie.attributes[flag]}` : flag === "httponly" ? "HttpOnly" : "Secure"))
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
