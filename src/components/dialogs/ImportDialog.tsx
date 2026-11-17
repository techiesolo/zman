import { AlertTriangle, CheckCircle2, FileUp, XCircle } from "lucide-react";
import { useState, type DragEvent } from "react";
import { backend } from "../../backend";
import { CurlParseError, looksLikeCurl, parseCurl } from "../../lib/curl/parse";
import { ImportError, importPostmanJson } from "../../lib/postman/import";
import type { KV } from "../../model/types";
import { useApp } from "../../store/app";
import { Modal } from "../ui/Modal";

interface Outcome {
  id: number;
  source: string;
  ok: boolean;
  title: string;
  detail: string;
  warnings: string[];
}

let nextOutcome = 1;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Globals from a file update the values of names that exist and add the rest. */
function mergeGlobals(current: KV[], incoming: KV[]): KV[] {
  const merged = current.map((row) => ({ ...row }));
  for (const row of incoming) {
    const existing = merged.find((candidate) => candidate.key === row.key);
    if (existing) Object.assign(existing, { value: row.value, enabled: row.enabled });
    else merged.push(row);
  }
  return merged;
}

function importOne(source: string, text: string): Outcome {
  const app = useApp.getState();
  const base = { id: nextOutcome++, source };
  try {
    if (looksLikeCurl(text)) {
      const { request, warnings } = parseCurl(text);
      app.newTab(request, "Imported cURL");
      return { ...base, ok: true, title: "cURL command", detail: `${request.method} request opened in a new tab.`, warnings };
    }
    const result = importPostmanJson(text);
    if (result.kind === "collection") {
      app.addCollection(result.collection);
      return {
        ...base,
        ok: true,
        title: result.collection.name,
        detail: `Collection with ${plural(result.stats.requests, "request")} in ${plural(result.stats.folders, "folder")}.`,
        warnings: result.warnings,
      };
    }
    const count = plural(result.environment.variables.length, "variable");
    if (result.scope === "globals") {
      app.setGlobals(mergeGlobals(app.globals, result.environment.variables));
      return { ...base, ok: true, title: "Globals", detail: `${count} merged into your global variables.`, warnings: result.warnings };
    }
    app.addEnvironment(result.environment);
    return { ...base, ok: true, title: result.environment.name, detail: `Environment with ${count}.`, warnings: result.warnings };
  } catch (error) {
    const known = error instanceof ImportError || error instanceof CurlParseError;
    return {
      ...base,
      ok: false,
      title: source,
      detail: known ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      warnings: [],
    };
  }
}

export function ImportDialog() {
  const app = useApp.getState();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [pasted, setPasted] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (sources: { name: string; contents: string }[]) => {
    if (sources.length === 0) return;
    const results = sources.map((source) => importOne(source.name, source.contents));
    setOutcomes((previous) => [...results, ...previous]);
  };

  const choose = async () => {
    setBusy(true);
    try {
      run(await backend.pickImportFiles());
    } catch (error) {
      app.toast(`Could not read the files: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const files = [...event.dataTransfer.files];
    if (files.length === 0) {
      const text = event.dataTransfer.getData("text/plain");
      if (text.trim()) run([{ name: "Dropped text", contents: text }]);
      return;
    }
    const sources = await Promise.all(files.map(async (file) => ({ name: file.name, contents: await file.text() })));
    run(sources);
  };

  return (
    <Modal
      title="Import"
      onClose={app.closeDialog}
      width={640}
      tall
      footer={
        <button type="button" className="btn btn-primary" onClick={app.closeDialog}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center ${
            over ? "border-accent bg-accent-soft" : "border-line"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void drop(e)}
        >
          <FileUp size={24} className="text-faint" />
          <div>Drop Postman files here</div>
          <div className="text-xs text-muted">Collections (v2.0 and v2.1), environments and globals exported from Postman.</div>
          <button type="button" className="btn mt-1" disabled={busy} onClick={() => void choose()}>
            Choose files…
          </button>
        </div>

        <div>
          <label className="label" htmlFor="import-paste">
            Or paste collection JSON or a cURL command
          </label>
          <textarea
            id="import-paste"
            className="input h-24 resize-none font-mono text-xs"
            spellCheck={false}
            placeholder={"curl https://api.example.com/users -H 'Accept: application/json'"}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="btn"
              disabled={pasted.trim() === ""}
              onClick={() => {
                run([{ name: "Pasted text", contents: pasted }]);
                setPasted("");
              }}
            >
              Import pasted text
            </button>
          </div>
        </div>

        {outcomes.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Import results">
            {outcomes.map((outcome) => (
              <li key={outcome.id} className={`rounded-md border px-3 py-2 ${outcome.ok ? "border-line" : "border-danger bg-danger-soft"}`}>
                <div className="flex items-start gap-2">
                  {outcome.ok ? (
                    <CheckCircle2 size={16} className="mt-0.5 flex-none text-ok" />
                  ) : (
                    <XCircle size={16} className="mt-0.5 flex-none text-danger" />
                  )}
                  <div className="selectable min-w-0 flex-1">
                    <div className="truncate font-medium">{outcome.ok ? outcome.title : `Could not import ${outcome.title}`}</div>
                    <div className="text-xs leading-relaxed text-muted">{outcome.detail}</div>
                    {outcome.ok && outcome.source !== outcome.title && !outcome.source.endsWith(" text") && (
                      <div className="truncate text-xs text-faint">{outcome.source}</div>
                    )}
                  </div>
                </div>
                {outcome.warnings.length > 0 && (
                  <ul className="selectable mt-2 mb-0 flex list-none flex-col gap-1 rounded bg-warn-soft px-2.5 py-2 text-xs leading-relaxed">
                    {outcome.warnings.map((warning, index) => (
                      <li key={index} className="flex items-start gap-1.5">
                        <AlertTriangle size={12} className="mt-0.5 flex-none text-warn" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
