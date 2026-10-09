// File extension → Monaco language id.
const MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", md: "markdown", markdown: "markdown",
  css: "css", scss: "scss", less: "less", html: "html", htm: "html", vue: "html", svelte: "html",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", cs: "csharp", fs: "fsharp",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", hpp: "cpp", rb: "ruby", php: "php", swift: "swift",
  lua: "lua", sql: "sql", sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell", psm1: "powershell",
  ini: "ini", toml: "ini", cfg: "ini", yaml: "yaml", yml: "yaml", xml: "xml", svg: "xml", xaml: "xml",
  dockerfile: "dockerfile", bat: "bat", cmd: "bat", r: "r", dart: "dart", graphql: "graphql",
  powershell: "powershell", python: "python", rust: "rust", typescript: "typescript", javascript: "javascript",
  shell: "shell", csharp: "csharp", yml2: "yaml", nsi: "plaintext",
};

export function langFor(path: string, hint?: string): string {
  const base = path.split(/[\/]/).pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()! : base;
  return MAP[hint ?? ""] ?? MAP[ext] ?? "plaintext";
}
