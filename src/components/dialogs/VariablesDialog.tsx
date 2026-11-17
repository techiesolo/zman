import { Download } from "lucide-react";
import { kv } from "../../model/factory";
import { useApp } from "../../store/app";
import { exportEnvironmentFile, exportGlobalsFile } from "../actions";
import { KVTable } from "../ui/KVTable";
import { Modal } from "../ui/Modal";
import { VarsContext } from "../vars";

type Target = { kind: "globals" } | { kind: "environment"; id: string };

/** Edits the variables of an environment, or the globals. Changes apply as you type. */
export function VariablesDialog({ target }: { target: Target }) {
  const app = useApp.getState();
  const globals = useApp((s) => s.globals);
  const environment = useApp((s) => (target.kind === "environment" ? s.environments.find((e) => e.id === target.id) : undefined));
  const active = useApp((s) => target.kind === "environment" && s.activeEnvId === target.id);

  if (target.kind === "environment" && !environment) return null;
  const rows = environment ? environment.variables : globals;

  return (
    <Modal
      title={environment ? "Environment" : "Global variables"}
      onClose={app.closeDialog}
      width={720}
      tall
      footer={
        <>
          <button
            type="button"
            className="btn mr-auto"
            onClick={() => void (environment ? exportEnvironmentFile(environment) : exportGlobalsFile(globals))}
          >
            <Download size={14} /> Export
          </button>
          {environment && !active && (
            <button type="button" className="btn" onClick={() => app.setActiveEnv(environment.id)}>
              Set as active
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={app.closeDialog}>
            Done
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {environment ? (
          <label>
            <span className="label">Name</span>
            <input
              className="input"
              value={environment.name}
              onChange={(e) => app.updateEnvironment(environment.id, (env) => void (env.name = e.target.value))}
            />
          </label>
        ) : (
          <p className="m-0 text-xs leading-relaxed text-muted">
            Globals are available in every request. A collection variable or the active environment overrides a global
            with the same name.
          </p>
        )}
        {/* Values may refer to other variables, but are not highlighted against themselves. */}
        <VarsContext.Provider value={null}>
          <KVTable
            ariaLabel="Variables"
            rows={rows}
            onChange={(next) =>
              environment ? app.updateEnvironment(environment.id, (env) => void (env.variables = next)) : app.setGlobals(next)
            }
            make={(id) => ({ ...kv(), id })}
            keyLabel="Variable"
            variablesInKey={false}
          />
        </VarsContext.Provider>
        <p className="m-0 text-xs leading-relaxed text-faint">
          Use a variable as <code className="font-mono">{"{{name}}"}</code> in URLs, headers, bodies and authorization.
          Unchecked rows are ignored. Values are stored as plain text on this computer.
        </p>
      </div>
    </Modal>
  );
}
