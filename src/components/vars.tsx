import { createContext, useContext, useMemo } from "react";
import { buildVarMap, type VarMap } from "../lib/variables";
import { useApp } from "../store/app";

const EMPTY: VarMap = new Map();

/**
 * The variables in scope for whatever is being edited, so inputs can show
 * which `{{names}}` resolve. Null means "do not highlight variables here".
 */
export const VarsContext = createContext<VarMap | null>(null);

export function useVars(): VarMap | null {
  return useContext(VarsContext);
}

/** Globals, then the collection's variables, then the active environment's. */
export function useScopeVars(collectionId: string | null | undefined): VarMap {
  const globals = useApp((s) => s.globals);
  const collectionVars = useApp((s) => (collectionId ? s.collections.find((c) => c.id === collectionId)?.variables : undefined));
  const envVars = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.variables);
  return useMemo(() => buildVarMap(globals, collectionVars, envVars), [globals, collectionVars, envVars]);
}

export { EMPTY as NO_VARS };
