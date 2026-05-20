import { useMemo } from "react";
import MonacoEditor, { loader, type Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";

loader.config({ monaco });

const languageId = "agent-vault-effect";
const themeId = "agent-vault-effect-dark";

let monacoConfigured = false;

const typescriptKeywords = [
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "satisfies",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "while",
  "yield",
] as const;

const typeKeywords = [
  "boolean",
  "never",
  "number",
  "object",
  "readonly",
  "string",
  "unknown",
  "void",
] as const;

export default function EffectCodeViewer({
  value,
  maxHeight = 420,
  ariaLabel = "Effect TypeScript code",
  fileName = "generated-layer.ts",
}: {
  readonly value: string;
  readonly maxHeight?: number;
  readonly ariaLabel?: string;
  readonly fileName?: string;
}) {
  const height = useMemo(() => editorHeight(value, maxHeight), [maxHeight, value]);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-[#09090b]">
      <MonacoEditor
        beforeMount={configureMonaco}
        height={height}
        language={languageId}
        path={fileName}
        theme={themeId}
        value={value}
        options={{
          ariaLabel,
          automaticLayout: true,
          contextmenu: false,
          domReadOnly: true,
          folding: false,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontLigatures: false,
          fontSize: 12.8,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 2,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          padding: { top: 14, bottom: 14 },
          readOnly: true,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          scrollbar: {
            alwaysConsumeMouseWheel: false,
            horizontalScrollbarSize: 8,
            verticalScrollbarSize: 8,
          },
          smoothScrolling: true,
          wordWrap: "on",
          wrappingIndent: "same",
        }}
      />
    </div>
  );
}

function configureMonaco(monaco: Monaco) {
  if (monacoConfigured) {
    return;
  }

  monacoConfigured = true;

  if (
    !monaco.languages
      .getLanguages()
      .some((language: { readonly id: string }) => language.id === languageId)
  ) {
    monaco.languages.register({
      id: languageId,
      aliases: ["Agent Vault Effect"],
    });
  }

  monaco.languages.setMonarchTokensProvider(languageId, {
    defaultToken: "",
    tokenPostfix: ".ts",
    keywords: [...typescriptKeywords],
    typeKeywords: [...typeKeywords],
    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    operators: [
      "=",
      ">",
      "<",
      "!",
      "~",
      "?",
      ":",
      "==",
      "<=",
      ">=",
      "!=",
      "&&",
      "||",
      "++",
      "--",
      "+",
      "-",
      "*",
      "/",
      "&",
      "|",
      "^",
      "%",
      "<<",
      ">>",
      ">>>",
      "+=",
      "-=",
      "*=",
      "/=",
      "&=",
      "|=",
      "^=",
      "%=",
      "<<=",
      ">>=",
      ">>>=",
      "=>",
    ],
    tokenizer: {
      root: [
        [
          /(sh)(\s*)(`)/,
          [
            "tag.shell",
            "white",
            { token: "string.backtick.shell", next: "@shellTemplate" },
          ],
        ],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/[{}()[\]]/, "@brackets"],
        [
          /[a-zA-Z_$][\w$]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@default": "identifier",
            },
          },
        ],
        [/[A-Z][\w$]*/, "type.identifier"],
        [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
        [/\d+/, "number"],
        [/"/, "string", "@stringDouble"],
        [/'/, "string", "@stringSingle"],
        [/`/, "string.backtick", "@templateString"],
        [
          /@symbols/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],
        [/[;,.]/, "delimiter"],
        [/\s+/, "white"],
      ],
      shellTemplate: [
        [/`/, { token: "string.backtick.shell", next: "@pop" }],
        [/\$\{/, { token: "delimiter.bracket", next: "@tsInterpolation" }],
        [/#.*$/, "comment.shell"],
        [
          /\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|select|until)\b/,
          "keyword.shell",
        ],
        [
          /\b(set|export|cd|rm|npm|npx|printf|echo|cat|mkdir|cp|mv|test|true|false)\b/,
          "predefined.shell",
        ],
        [/--[A-Za-z0-9][\w-]*/, "attribute.name.shell"],
        [/\$[A-Za-z_]\w*/, "variable.shell"],
        [/"([^"\\]|\\.)*"/, "string.shell"],
        [/'[^']*'/, "string.shell"],
        [/[;&|<>]+/, "operator.shell"],
        [/[(){}[\]]/, "@brackets"],
        [/[^\s`$#"';&|<>(){}[\]]+/, "source.shell"],
        [/\s+/, "white"],
        [/./, "source.shell"],
      ],
      tsInterpolation: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        { include: "root" },
      ],
      templateString: [
        [/`/, { token: "string.backtick", next: "@pop" }],
        [/\$\{/, { token: "delimiter.bracket", next: "@tsInterpolation" }],
        [/[^`$]+/, "string"],
        [/./, "string"],
      ],
      stringDouble: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string", next: "@pop" }],
      ],
      stringSingle: [
        [/[^\\']+/, "string"],
        [/\\./, "string.escape"],
        [/'/, { token: "string", next: "@pop" }],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],
    },
  });

  monaco.editor.defineTheme(themeId, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "tag.shell", foreground: "a7f3d0", fontStyle: "bold" },
      { token: "keyword", foreground: "93c5fd" },
      { token: "type", foreground: "c4b5fd" },
      { token: "type.identifier", foreground: "f0abfc" },
      { token: "comment", foreground: "71717a" },
      { token: "string", foreground: "facc15" },
      { token: "string.shell", foreground: "fde68a" },
      { token: "keyword.shell", foreground: "60a5fa", fontStyle: "bold" },
      { token: "predefined.shell", foreground: "34d399" },
      { token: "attribute.name.shell", foreground: "fbbf24" },
      { token: "variable.shell", foreground: "f472b6" },
      { token: "operator.shell", foreground: "fda4af" },
      { token: "source.shell", foreground: "e4e4e7" },
      { token: "number", foreground: "fdba74" },
      { token: "operator", foreground: "cbd5e1" },
      { token: "delimiter", foreground: "a1a1aa" },
    ],
    colors: {
      "editor.background": "#09090b",
      "editor.foreground": "#f4f4f5",
      "editor.lineHighlightBackground": "#18181b",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.selectionBackground": "#065f46",
      "editor.inactiveSelectionBackground": "#064e3b66",
      "editorGutter.background": "#09090b",
      "scrollbarSlider.background": "#3f3f4680",
      "scrollbarSlider.hoverBackground": "#52525b99",
    },
  });
}

function editorHeight(value: string, maxHeight: number) {
  const lineCount = value.split("\n").length;
  return Math.min(maxHeight, Math.max(220, lineCount * 20 + 32));
}
