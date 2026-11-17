import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { isDynamicVariable, type VarMap } from "../../lib/variables";
import { useVars } from "../vars";

export type CodeLanguage = "json" | "xml" | "html" | "javascript" | "text";

/** One theme for light and dark: every color comes from a CSS variable. */
const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "var(--fg)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--active)" },
  ".cm-selectionMatch": { backgroundColor: "var(--hover)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warn) 35%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warn) 65%, transparent)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "var(--active)", outline: "none" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--hover)", border: "none", color: "var(--muted)", padding: "0 4px" },
  ".cm-placeholder": { color: "var(--faint)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
  ".cm-textfield": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "4px",
    color: "var(--fg)",
    fontSize: "12px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "4px",
    color: "var(--fg)",
    fontSize: "12px",
  },
  ".cm-panel.cm-search label": { fontSize: "12px" },
  ".cm-panel.cm-search [name=close]": { color: "var(--muted)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    border: "1px solid var(--line)",
    color: "var(--fg)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-fg)" },
});

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.propertyName, t.attributeName, t.tagName], color: "var(--syn-key)" },
    { tag: [t.string, t.special(t.string), t.attributeValue], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.keyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--syn-keyword)" },
    { tag: [t.comment, t.meta, t.processingInstruction, t.documentMeta], color: "var(--syn-comment)" },
    { tag: [t.angleBracket, t.punctuation, t.separator, t.bracket], color: "var(--muted)" },
    { tag: t.invalid, color: "var(--danger)" },
  ]),
);

const LANGUAGES: Record<CodeLanguage, () => Extension> = {
  json: () => json(),
  xml: () => xml(),
  html: () => html(),
  javascript: () => javascript(),
  text: () => [],
};

function variableHighlighter(vars: VarMap): Extension {
  const decorator = new MatchDecorator({
    regexp: /\{\{([^{}]+?)\}\}/g,
    decoration: (match) => {
      const name = match[1]!.trim();
      return Decoration.mark({ class: vars.has(name) || isDynamicVariable(name) ? "var-ok" : "var-missing" });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

interface CodeEditorProps {
  value: string;
  onChange?(value: string): void;
  language: CodeLanguage;
  readOnly?: boolean;
  wrap?: boolean;
  placeholder?: string;
  /** Color `{{variables}}` using the variables in scope. */
  variables?: boolean;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  wrap = true,
  placeholder,
  variables = false,
  ariaLabel,
}: CodeEditorProps) {
  const vars = useVars();
  const extensions = useMemo(() => {
    const list: Extension[] = [LANGUAGES[language](), highlight];
    if (wrap) list.push(EditorView.lineWrapping);
    if (variables && vars) list.push(variableHighlighter(vars));
    if (ariaLabel) list.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    return list;
  }, [language, wrap, variables, vars, ariaLabel]);

  return (
    <CodeMirror
      className="h-full min-h-0 w-full overflow-hidden"
      value={value}
      onChange={onChange}
      height="100%"
      theme={theme}
      extensions={extensions}
      readOnly={readOnly}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        closeBrackets: !readOnly,
        searchKeymap: true,
        tabSize: 2,
      }}
    />
  );
}
