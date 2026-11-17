import { useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { findVariableTokens } from "../../lib/variables";
import { useVars } from "../vars";

interface VarInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  /** Classes for the input itself; the backdrop copies its box. */
  className?: string;
  mono?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
  onPaste?(event: ClipboardEvent<HTMLInputElement>): void;
}

/**
 * A text input that colors `{{variables}}`. The input's own text is made
 * transparent and an identically laid out copy underneath carries the colors,
 * which keeps caret, selection and IME behavior native.
 */
export function VarInput({
  value,
  onChange,
  placeholder,
  className = "cell-input",
  mono = false,
  autoFocus,
  ariaLabel,
  onKeyDown,
  onPaste,
}: VarInputProps) {
  const vars = useVars();
  const backdrop = useRef<HTMLDivElement>(null);
  const tokens = vars && value.includes("{{") ? findVariableTokens(value, vars) : [];
  const highlighted = tokens.length > 0;

  const syncScroll = (input: HTMLInputElement) => {
    if (backdrop.current) backdrop.current.scrollLeft = input.scrollLeft;
  };

  let title: string | undefined;
  const parts: ReactNode[] = [];
  if (highlighted && vars) {
    let at = 0;
    const lines = new Set<string>();
    for (const token of tokens) {
      if (token.from > at) parts.push(value.slice(at, token.from));
      parts.push(
        <span key={token.from} className={token.resolved ? "var-ok" : "var-missing"}>
          {value.slice(token.from, token.to)}
        </span>,
      );
      at = token.to;
      if (!token.resolved) lines.add(`${token.name}: not defined`);
      else if (vars.has(token.name)) lines.add(`${token.name} = ${vars.get(token.name)}`);
      else lines.add(`${token.name}: generated when the request is sent`);
    }
    if (at < value.length) parts.push(value.slice(at));
    title = [...lines].join("\n");
  }

  const font = mono ? "font-mono text-[12.5px]" : "";

  return (
    <div className="var-input min-w-0 flex-1" title={title}>
      {highlighted && (
        <div ref={backdrop} aria-hidden className={`var-backdrop flex items-center ${className} ${font}`}>
          <span className="flex-none">{parts}</span>
        </div>
      )}
      <input
        className={`${className} ${font} ${highlighted ? "var-highlighted" : ""}`}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => {
          onChange(e.target.value);
          syncScroll(e.target);
        }}
        onScroll={(e) => syncScroll(e.currentTarget)}
        onKeyUp={(e) => syncScroll(e.currentTarget)}
        onSelect={(e) => syncScroll(e.currentTarget)}
        onBlur={(e) => syncScroll(e.currentTarget)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    </div>
  );
}
