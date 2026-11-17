import { Copy } from "lucide-react";
import { useMemo } from "react";
import { buildRequest, effectiveAuth } from "../../lib/buildRequest";
import { generateCurl } from "../../lib/curl/generate";
import { tabContext, useApp } from "../../store/app";
import { copyText } from "../ui/bits";
import { CodeEditor } from "../ui/CodeEditor";
import { Modal } from "../ui/Modal";
import { useScopeVars } from "../vars";

/** The request as a cURL command, with variables and inherited auth applied. */
export function CodeDialog({ tabId }: { tabId: string }) {
  const app = useApp.getState();
  const tab = useApp((s) => s.tabs.find((t) => t.id === tabId));
  const collections = useApp((s) => s.collections);
  const settings = useApp((s) => s.settings);
  const vars = useScopeVars(tab?.source?.collectionId);

  const result = useMemo(() => {
    if (!tab) return null;
    const context = tabContext({ collections }, tab);
    const { auth } = effectiveAuth(tab.draft.auth, context?.ancestors ?? [], context?.collection);
    try {
      const built = buildRequest({ request: tab.draft, auth, vars, settings });
      return { command: generateCurl(built.spec), warnings: built.warnings, error: null };
    } catch (error) {
      return { command: "", warnings: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [tab, collections, settings, vars]);

  if (!result) return null;

  return (
    <Modal
      title="cURL command"
      onClose={app.closeDialog}
      width={760}
      tall
      footer={
        <>
          <span className="mr-auto text-xs text-muted">Variables are replaced with their current values.</span>
          <button type="button" className="btn" onClick={app.closeDialog}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={result.error !== null}
            autoFocus
            onClick={async () => {
              const ok = await copyText(result.command);
              app.toast(ok ? "Copied the cURL command." : "Could not copy to the clipboard.", ok ? "success" : "error");
              if (ok) app.closeDialog();
            }}
          >
            <Copy size={14} /> Copy
          </button>
        </>
      }
    >
      {result.error !== null ? (
        <p className="m-0 rounded-md bg-danger-soft px-3 py-2 text-danger">{result.error}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {result.warnings.length > 0 && (
            <div className="flex-none rounded-md bg-warn-soft px-3 py-2 text-xs leading-relaxed">
              {result.warnings.map((warning, index) => (
                <div key={index}>{warning}</div>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
            <CodeEditor ariaLabel="cURL command" language="text" readOnly value={result.command} />
          </div>
        </div>
      )}
    </Modal>
  );
}
