import type { KV } from "../model/types";

export type VarMap = Map<string, string>;

/** Later scopes win: pass them as (globals, collection, environment). */
export function buildVarMap(...scopes: (KV[] | undefined)[]): VarMap {
  const map: VarMap = new Map();
  for (const scope of scopes) {
    for (const row of scope ?? []) {
      if (row.enabled && row.key !== "") map.set(row.key, row.value);
    }
  }
  return map;
}

const DYNAMIC: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
};

export function isDynamicVariable(name: string): boolean {
  return name in DYNAMIC;
}

const TOKEN = /\{\{([^{}]+?)\}\}/g;
const MAX_DEPTH = 10;

/**
 * Replaces `{{name}}` tokens. Values may themselves reference variables; the
 * depth limit stops reference cycles. Unknown names are left untouched so the
 * user can see them in what was sent.
 */
export function resolveVariables(text: string, vars: VarMap): string {
  let out = text;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let changed = false;
    out = out.replace(TOKEN, (whole, rawName: string) => {
      const name = rawName.trim();
      const dynamic = DYNAMIC[name];
      const value = vars.has(name) ? vars.get(name)! : dynamic ? dynamic() : undefined;
      if (value === undefined) return whole;
      changed = true;
      return value;
    });
    if (!changed) break;
  }
  return out;
}

export interface VariableToken {
  name: string;
  from: number;
  to: number;
  resolved: boolean;
}

/** Locates `{{name}}` tokens for highlighting. */
export function findVariableTokens(text: string, vars: VarMap): VariableToken[] {
  const tokens: VariableToken[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const name = m[1]!.trim();
    tokens.push({
      name,
      from: m.index,
      to: m.index + m[0].length,
      resolved: vars.has(name) || isDynamicVariable(name),
    });
  }
  return tokens;
}
