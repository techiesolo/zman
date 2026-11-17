import { File as FileIcon, Trash2, X } from "lucide-react";
import { useRef } from "react";
import { backend } from "../../backend";
import { newId } from "../../model/factory";
import type { FormPart, KV } from "../../model/types";
import { VarInput } from "./VarInput";

interface KVTableProps<T extends KV> {
  rows: T[];
  onChange(rows: T[]): void;
  /** Builds the row that typing into the empty last line creates. */
  make(id: string): T;
  keyLabel?: string;
  valueLabel?: string;
  /** Rows are fixed (path variables): only values can be edited. */
  fixedKeys?: boolean;
  /** Rows are multipart form parts and can be switched to file uploads. */
  fileParts?: boolean;
  /** Color `{{variables}}` in keys and values. Off for variable definitions' keys. */
  variablesInKey?: boolean;
  ariaLabel: string;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * An editable key/value grid. The last line is always an empty "ghost" row;
 * typing into it turns it into a real row under the same React key, so the
 * input keeps focus while a fresh ghost appears below.
 */
export function KVTable<T extends KV>({
  rows,
  onChange,
  make,
  keyLabel = "Key",
  valueLabel = "Value",
  fixedKeys = false,
  fileParts = false,
  variablesInKey = true,
  ariaLabel,
}: KVTableProps<T>) {
  const ghostId = useRef(newId());
  if (rows.some((row) => row.id === ghostId.current)) ghostId.current = newId();

  const ghost = make(ghostId.current);
  const lines = fixedKeys ? rows : [...rows, ghost];

  const update = (id: string, patch: Partial<KV> | Partial<FormPart>) => {
    if (id === ghostId.current) onChange([...rows, { ...ghost, ...patch }]);
    else onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id));

  const columns = `${fixedKeys ? "" : "30px "}minmax(0,1fr) minmax(0,1.4fr)${fixedKeys ? "" : " 30px"}`;
  const cell = "flex min-w-0 items-center border-l border-line";

  return (
    <div role="table" aria-label={ariaLabel} className="rounded-md border border-line text-[13px]">
      <div role="row" className="grid bg-panel text-xs font-medium text-muted" style={{ gridTemplateColumns: columns }}>
        {!fixedKeys && <div />}
        <div role="columnheader" className={`${fixedKeys ? "" : "border-l border-line"} px-2 py-1.5`}>
          {keyLabel}
        </div>
        <div role="columnheader" className="border-l border-line px-2 py-1.5">
          {valueLabel}
        </div>
        {!fixedKeys && <div />}
      </div>

      {lines.map((row) => {
        const isGhost = row.id === ghostId.current && !fixedKeys;
        const part = fileParts ? (row as unknown as FormPart) : null;
        const dim = !row.enabled && !isGhost ? "opacity-50" : "";
        return (
          <div
            role="row"
            key={row.id}
            className="group grid border-t border-line"
            style={{ gridTemplateColumns: columns }}
          >
            {!fixedKeys && (
              <div className="flex items-center justify-center">
                {!isGhost && (
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={row.enabled}
                    aria-label={`Enable ${row.key || "row"}`}
                    onChange={(e) => update(row.id, { enabled: e.target.checked })}
                  />
                )}
              </div>
            )}

            <div role="cell" className={`${fixedKeys ? "flex min-w-0 items-center" : cell} ${dim}`}>
              {fixedKeys ? (
                <span className="selectable truncate px-2 font-mono text-[12.5px] text-muted">:{row.key}</span>
              ) : variablesInKey ? (
                <VarInput value={row.key} onChange={(key) => update(row.id, { key })} placeholder={keyLabel} ariaLabel={keyLabel} />
              ) : (
                <input
                  className="cell-input"
                  value={row.key}
                  placeholder={keyLabel}
                  aria-label={keyLabel}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(row.id, { key: e.target.value })}
                />
              )}
              {part && (
                <select
                  className="mr-1 h-6 flex-none rounded border-0 bg-transparent text-xs text-muted outline-none hover:bg-hover"
                  value={part.type}
                  aria-label="Part type"
                  onChange={(e) => update(row.id, { type: e.target.value as FormPart["type"], value: "" })}
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              )}
            </div>

            <div role="cell" className={`${cell} ${dim}`}>
              {part?.type === "file" ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5">
                  <button
                    type="button"
                    className="btn btn-sm min-w-0"
                    title={row.value || undefined}
                    onClick={async () => {
                      const path = await backend.pickFilePath();
                      if (path) update(row.id, { value: path });
                    }}
                  >
                    <FileIcon size={13} className="flex-none" />
                    <span className="truncate">{row.value ? basename(row.value) : "Choose file"}</span>
                  </button>
                  {row.value && (
                    <button type="button" className="icon-btn" aria-label="Clear file" onClick={() => update(row.id, { value: "" })}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : (
                <VarInput
                  value={row.value}
                  onChange={(value) => update(row.id, { value })}
                  placeholder={valueLabel}
                  ariaLabel={valueLabel}
                />
              )}
            </div>

            {!fixedKeys && (
              <div className="flex items-center justify-center">
                {!isGhost && (
                  <button
                    type="button"
                    className="icon-btn opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    aria-label={`Delete ${row.key || "row"}`}
                    onClick={() => remove(row.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
