import type { ReactNode } from "react";
import type { Auth } from "../model/types";
import { VarInput } from "./ui/VarInput";

type AuthType = Auth["type"];

const LABELS: Record<AuthType, string> = {
  inherit: "Inherit from parent",
  none: "No Auth",
  basic: "Basic Auth",
  bearer: "Bearer Token",
  apikey: "API Key",
  unsupported: "Unsupported",
};

function describe(auth: Auth): string {
  if (auth.type === "unsupported") return `${auth.postmanType} (not supported)`;
  return LABELS[auth.type];
}

function blank(type: AuthType, previous: Auth): Auth {
  switch (type) {
    case "basic":
      return { type, username: "", password: "" };
    case "bearer":
      return { type, token: "" };
    case "apikey":
      return { type, key: "", value: "", in: "header" };
    case "unsupported":
      return previous;
    default:
      return { type };
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

interface AuthEditorProps {
  auth: Auth;
  onChange(auth: Auth): void;
  /** Collections have no parent to inherit from. */
  allowInherit: boolean;
  /** What "inherit" currently resolves to, for display. */
  inherited?: { auth: Auth; from?: string };
}

export function AuthEditor({ auth, onChange, allowInherit, inherited }: AuthEditorProps) {
  const types: AuthType[] = ["none", "basic", "bearer", "apikey"];
  if (allowInherit) types.unshift("inherit");
  if (auth.type === "unsupported") types.push("unsupported");

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Field label="Type">
        <select
          className="input w-56"
          value={auth.type}
          onChange={(e) => onChange(blank(e.target.value as AuthType, auth))}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type === "unsupported" ? describe(auth) : LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      {auth.type === "inherit" && (
        <p className="m-0 text-xs leading-relaxed text-muted">
          {inherited?.from ? (
            <>
              Uses <b className="text-fg">{describe(inherited.auth)}</b> from <b className="text-fg">{inherited.from}</b>.
            </>
          ) : (
            "No parent folder or collection defines authorization, so the request is sent without it."
          )}
        </p>
      )}
      {auth.type === "none" && <p className="m-0 text-xs text-muted">The request is sent without authorization.</p>}

      {auth.type === "basic" && (
        <>
          <Field label="Username">
            <VarInput className="input" value={auth.username} onChange={(username) => onChange({ ...auth, username })} ariaLabel="Username" />
          </Field>
          <Field label="Password">
            <VarInput className="input" value={auth.password} onChange={(password) => onChange({ ...auth, password })} ariaLabel="Password" />
          </Field>
        </>
      )}

      {auth.type === "bearer" && (
        <Field label="Token">
          <VarInput className="input" mono value={auth.token} onChange={(token) => onChange({ ...auth, token })} ariaLabel="Token" />
        </Field>
      )}

      {auth.type === "apikey" && (
        <>
          <Field label="Key">
            <VarInput
              className="input"
              value={auth.key}
              onChange={(key) => onChange({ ...auth, key })}
              placeholder="X-API-Key"
              ariaLabel="Key"
            />
          </Field>
          <Field label="Value">
            <VarInput className="input" mono value={auth.value} onChange={(value) => onChange({ ...auth, value })} ariaLabel="Value" />
          </Field>
          <Field label="Add to">
            <select
              className="input w-56"
              value={auth.in}
              onChange={(e) => onChange({ ...auth, in: e.target.value as "header" | "query" })}
            >
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </Field>
        </>
      )}

      {auth.type === "unsupported" && (
        <p className="m-0 rounded-md bg-warn-soft px-3 py-2 text-xs leading-relaxed">
          This request uses <b>{auth.postmanType}</b> authorization, which zman cannot apply yet. The settings are kept
          and exported unchanged, but the request is sent without them. Add an <code>Authorization</code> header by hand,
          or pick another type.
        </p>
      )}
    </div>
  );
}
