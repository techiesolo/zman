import { File as FileIcon, Wand2, X } from "lucide-react";
import { backend } from "../backend";
import { prettyJson } from "../lib/format";
import { formPart, kv } from "../model/factory";
import type { Body, BodyMode, RawLanguage } from "../model/types";
import { useApp } from "../store/app";
import { CodeEditor } from "./ui/CodeEditor";
import { KVTable } from "./ui/KVTable";

const MODES: { id: BodyMode; label: string }[] = [
  { id: "none", label: "none" },
  { id: "formdata", label: "form-data" },
  { id: "urlencoded", label: "x-www-form-urlencoded" },
  { id: "raw", label: "raw" },
  { id: "binary", label: "binary" },
  { id: "graphql", label: "GraphQL" },
];

const LANGUAGES: { id: RawLanguage; label: string }[] = [
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "xml", label: "XML" },
  { id: "html", label: "HTML" },
  { id: "javascript", label: "JavaScript" },
];

interface BodyEditorProps {
  body: Body;
  /** Applies an in-place change to the body. */
  onChange(recipe: (body: Body) => void): void;
}

export function BodyEditor({ body, onChange }: BodyEditorProps) {
  const toast = useApp((s) => s.toast);

  const beautify = (text: string, apply: (pretty: string) => void) => {
    const pretty = prettyJson(text);
    if (pretty === null) toast("The body is not valid JSON, so it was left as it is.", "error");
    else apply(pretty);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <div role="radiogroup" aria-label="Body type" className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {MODES.map((mode) => (
            <label key={mode.id} className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="body-mode"
                className="accent-[var(--accent)]"
                checked={body.mode === mode.id}
                onChange={() => onChange((b) => void (b.mode = mode.id))}
              />
              {mode.label}
            </label>
          ))}
        </div>
        {body.mode === "raw" && (
          <>
            <select
              className="input h-6.5 w-28 text-xs"
              aria-label="Body language"
              value={body.rawLanguage}
              onChange={(e) => onChange((b) => void (b.rawLanguage = e.target.value as RawLanguage))}
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
            {body.rawLanguage === "json" && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => beautify(body.raw, (pretty) => onChange((b) => void (b.raw = pretty)))}
              >
                <Wand2 size={13} /> Beautify
              </button>
            )}
          </>
        )}
      </div>

      {body.mode === "none" && <p className="m-0 px-3 py-2 text-xs text-muted">This request has no body.</p>}

      {body.mode === "formdata" && (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <KVTable
            ariaLabel="Form data"
            rows={body.formdata}
            onChange={(rows) => onChange((b) => void (b.formdata = rows))}
            make={(id) => ({ ...formPart(), id })}
            fileParts
          />
        </div>
      )}

      {body.mode === "urlencoded" && (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <KVTable
            ariaLabel="Form fields"
            rows={body.urlencoded}
            onChange={(rows) => onChange((b) => void (b.urlencoded = rows))}
            make={(id) => ({ ...kv(), id })}
          />
        </div>
      )}

      {body.mode === "raw" && (
        <div className="min-h-0 flex-1 border-t border-line">
          <CodeEditor
            ariaLabel="Request body"
            language={body.rawLanguage}
            value={body.raw}
            onChange={(raw) => onChange((b) => void (b.raw = raw))}
            variables
          />
        </div>
      )}

      {body.mode === "binary" && (
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const path = await backend.pickFilePath();
              if (path) onChange((b) => void (b.binaryPath = path));
            }}
          >
            <FileIcon size={14} /> {body.binaryPath ? "Change file" : "Choose file"}
          </button>
          {body.binaryPath ? (
            <>
              <span className="selectable min-w-0 truncate font-mono text-xs" title={body.binaryPath}>
                {body.binaryPath}
              </span>
              <button type="button" className="icon-btn" aria-label="Clear file" onClick={() => onChange((b) => void (b.binaryPath = ""))}>
                <X size={14} />
              </button>
            </>
          ) : (
            <span className="text-xs text-muted">The file is read from disk when the request is sent.</span>
          )}
        </div>
      )}

      {body.mode === "graphql" && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] border-t border-line">
          <div className="flex min-h-0 flex-col">
            <div className="flex-none px-3 py-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Query</div>
            <div className="min-h-0 flex-1">
              <CodeEditor
                ariaLabel="GraphQL query"
                language="text"
                value={body.graphqlQuery}
                onChange={(query) => onChange((b) => void (b.graphqlQuery = query))}
                variables
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-col border-l border-line">
            <div className="flex flex-none items-center px-3 py-1 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <span className="flex-1">Variables (JSON)</span>
              <button
                type="button"
                className="icon-btn h-5 w-5"
                title="Beautify"
                aria-label="Beautify variables"
                onClick={() => beautify(body.graphqlVariables, (pretty) => onChange((b) => void (b.graphqlVariables = pretty)))}
              >
                <Wand2 size={12} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CodeEditor
                ariaLabel="GraphQL variables"
                language="json"
                value={body.graphqlVariables}
                onChange={(variables) => onChange((b) => void (b.graphqlVariables = variables))}
                variables
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
