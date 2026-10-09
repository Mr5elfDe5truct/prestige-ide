// Monaco's web workers (Vite bundles each as its own worker) and the Prestige editor theme.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

monaco.editor.defineTheme("prestige", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7d7268", fontStyle: "italic" },
    { token: "keyword", foreground: "e0726a" },
    { token: "string", foreground: "d9b46a" },
    { token: "number", foreground: "c99be0" },
    { token: "type", foreground: "7fc4b8" },
  ],
  colors: {
    "editor.background": "#16120f",
    "editor.foreground": "#e8e0d6",
    "editorLineNumber.foreground": "#5a5048",
    "editorLineNumber.activeForeground": "#c9a24a",
    "editor.selectionBackground": "#5a2a2655",
    "editor.lineHighlightBackground": "#1f1a16",
    "editorCursor.foreground": "#d9a441",
    "editorWidget.background": "#1d1814",
    "diffEditor.insertedTextBackground": "#3d6b3a40",
    "diffEditor.removedTextBackground": "#8a2a2a45",
    "diffEditor.insertedLineBackground": "#2b4a2930",
    "diffEditor.removedLineBackground": "#5a1d1d35",
  },
});
monaco.editor.setTheme("prestige");
// Plain diagnostics only: there's no project-wide type info, so red squiggles for missing imports would just be noise.
const ts: any = (monaco as any).typescript ?? (monaco.languages as any).typescript;
for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults]) d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: false });

export { monaco };
