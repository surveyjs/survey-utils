import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import { parse } from "json5";

/**
 * `survey-utils install-mcp [editor]`: adds the SurveyJS MCP server to a code editor's MCP
 * configuration, so an AI assistant in that editor can query the SurveyJS documentation.
 *
 *   survey-utils install-mcp                  # asks which editor; vscode is the default
 *   survey-utils install-mcp cursor
 *   survey-utils install-mcp vscode --path .   # workspace scope: .vscode/mcp.json, checked in
 *   survey-utils install-mcp webstorm --dry-run
 *
 * Every editor keeps its MCP servers in a JSON file of its own -- a different location and a
 * different shape per editor -- so both live in one table here. The command merges the server
 * into the file it finds (or creates one), and never touches the other servers in it. Editors
 * whose config only takes stdio servers (Claude Desktop, Zed) get the same server through
 * `npx mcp-remote`, the standard remote-to-stdio bridge.
 */

export const MCP_SERVER_URL = "https://mcp.surveyjs.io/mcp";

/** The key the server is registered under in every editor's config. */
export const MCP_SERVER_NAME = "surveyjs";

export const DEFAULT_EDITOR = "vscode";

export class InstallMcpUsageError extends Error {
  /** Same meaning as cli.ts' UsageError: the message already lists what the caller can pass. */
  constructor(message: string, public readonly selfContained: boolean = false) {
    super(message);
  }
}

/**
 * What the config-file locations are computed from, passed in rather than read off the process
 * so a test can pretend to be any OS.
 */
export interface McpEnvironment {
  platform: NodeJS.Platform;
  home: string;
  env: { [name: string]: string | undefined };
}

export function defaultEnvironment(): McpEnvironment {
  return { platform: process.platform, home: os.homedir(), env: process.env };
}

/** %APPDATA% -- the roaming config dir on Windows. */
function appData(env: McpEnvironment): string {
  return env.env.APPDATA || path.join(env.home, "AppData", "Roaming");
}

/** %LOCALAPPDATA% -- the local (non-roaming) config dir on Windows. */
function localAppData(env: McpEnvironment): string {
  return env.env.LOCALAPPDATA || path.join(env.home, "AppData", "Local");
}

/** The per-user config dir the OS convention puts application settings in. */
function userConfigDir(env: McpEnvironment): string {
  if (env.platform === "win32") return appData(env);
  if (env.platform === "darwin") return path.join(env.home, "Library", "Application Support");
  return env.env.XDG_CONFIG_HOME || path.join(env.home, ".config");
}

export interface McpEditor {
  /** The name the command line and the prompt accept. */
  id: string;
  /** The display name, for the prompt and the report. */
  name: string;
  /** The key the editor's config file nests its MCP servers under. */
  serversKey: string;
  /** The server entry written under that key -- each editor spells a remote server its own way. */
  entry: { [key: string]: unknown };
  configPath(env: McpEnvironment): string;
  /**
   * The per-project config the editor reads inside a workspace -- .vscode/mcp.json,
   * .cursor/mcp.json -- for the editors that have one. --path installs there instead of at
   * user scope, so the server can be checked in with the project.
   */
  workspaceConfigPath?(root: string): string;
  /** Printed after the install: a restart, a prerequisite, a caveat. */
  note?: string;
  /** Printed instead of note after a --path install, when the scope changes the advice. */
  workspaceNote?: string;
}

/** The entry for editors that take a remote server directly, in the common { type, url } shape. */
const httpEntry = { type: "http", url: MCP_SERVER_URL };

/** The entry for editors whose config only runs local commands: the mcp-remote bridge. */
const bridgeEntry = { command: "npx", args: ["-y", "mcp-remote", MCP_SERVER_URL] };

/**
 * The supported editors: the ten most popular MCP hosts, VS Code first because it is the
 * default. Each knows where its config file lives on each OS and how it spells a server entry;
 * everything else about the install is shared.
 */
export const mcpEditors: McpEditor[] = [
  {
    id: "vscode",
    name: "Visual Studio Code",
    serversKey: "servers",
    entry: httpEntry,
    configPath: (env) => path.join(userConfigDir(env), "Code", "User", "mcp.json"),
    workspaceConfigPath: (root) => path.join(root, ".vscode", "mcp.json"),
    note: "Open the Chat view and pick Agent mode to use the server."
  },
  {
    id: "vscode-insiders",
    name: "Visual Studio Code - Insiders",
    serversKey: "servers",
    entry: httpEntry,
    configPath: (env) => path.join(userConfigDir(env), "Code - Insiders", "User", "mcp.json"),
    workspaceConfigPath: (root) => path.join(root, ".vscode", "mcp.json"),
    note: "Open the Chat view and pick Agent mode to use the server."
  },
  {
    id: "cursor",
    name: "Cursor",
    serversKey: "mcpServers",
    entry: { url: MCP_SERVER_URL },
    configPath: (env) => path.join(env.home, ".cursor", "mcp.json"),
    workspaceConfigPath: (root) => path.join(root, ".cursor", "mcp.json"),
    note: "Restart Cursor to pick up the change."
  },
  {
    id: "windsurf",
    name: "Windsurf",
    serversKey: "mcpServers",
    entry: { serverUrl: MCP_SERVER_URL },
    configPath: (env) => path.join(env.home, ".codeium", "windsurf", "mcp_config.json"),
    note: "Refresh the plugins in Windsurf's Cascade panel to pick up the change."
  },
  {
    id: "webstorm",
    name: "WebStorm (GitHub Copilot plugin)",
    serversKey: "servers",
    entry: httpEntry,
    configPath: (env) => path.join(
      env.platform === "win32" ? localAppData(env) : path.join(env.home, ".config"),
      "github-copilot", "intellij", "mcp.json"
    ),
    note: "This file is read by the GitHub Copilot plugin (any JetBrains IDE, not just WebStorm).\n"
      + "JetBrains AI Assistant keeps its own list: add the server under\n"
      + "Settings | Tools | AI Assistant | Model Context Protocol (MCP) instead."
  },
  {
    id: "visual-studio",
    name: "Visual Studio",
    serversKey: "servers",
    entry: httpEntry,
    configPath: (env) => path.join(env.home, ".mcp.json"),
    workspaceConfigPath: (root) => path.join(root, ".mcp.json"),
    note: "Needs Visual Studio 2022 17.14 or later; the server appears in Copilot Chat's Agent mode."
  },
  {
    id: "claude-code",
    name: "Claude Code",
    serversKey: "mcpServers",
    entry: httpEntry,
    configPath: (env) => path.join(env.home, ".claude.json"),
    workspaceConfigPath: (root) => path.join(root, ".mcp.json"),
    note: "Installed at user scope: available in every project. Run /mcp inside Claude Code to check it.",
    workspaceNote: ".mcp.json is project scope: check it in and the whole team gets the server.\n"
      + "Run /mcp inside Claude Code to check it."
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    serversKey: "mcpServers",
    entry: bridgeEntry,
    configPath: (env) => path.join(userConfigDir(env), "Claude", "claude_desktop_config.json"),
    note: "Claude Desktop only runs local servers, so this goes through 'npx mcp-remote':\n"
      + "Node.js has to be on PATH. Restart Claude Desktop to pick up the change."
  },
  {
    id: "zed",
    name: "Zed",
    serversKey: "context_servers",
    entry: { source: "custom", ...bridgeEntry },
    configPath: (env) => env.platform === "win32"
      ? path.join(appData(env), "Zed", "settings.json")
      : path.join(env.home, ".config", "zed", "settings.json"),
    workspaceConfigPath: (root) => path.join(root, ".zed", "settings.json"),
    note: "Zed's settings only run local servers, so this goes through 'npx mcp-remote': Node.js\n"
      + "has to be on PATH. Comments in settings.json are not preserved by the rewrite."
  },
  {
    id: "cline",
    name: "Cline (VS Code extension)",
    serversKey: "mcpServers",
    entry: { url: MCP_SERVER_URL, type: "streamableHttp" },
    configPath: (env) => path.join(
      userConfigDir(env), "Code", "User", "globalStorage", "saoudrizwan.claude-dev",
      "settings", "cline_mcp_settings.json"
    ),
    note: "Open Cline's MCP Servers panel to check the connection."
  }
];

export const mcpEditorIds = mcpEditors.map((editor) => editor.id);

/** The editors --path can install for: the ones with a per-project config to write. */
export const workspaceMcpEditorIds =
  mcpEditors.filter((editor) => !!editor.workspaceConfigPath).map((editor) => editor.id);

export function findMcpEditor(id: string): McpEditor | undefined {
  const lower = id.toLowerCase();
  return mcpEditors.find((editor) => editor.id === lower);
}

function requireMcpEditor(id: string): McpEditor {
  const editor = findMcpEditor(id);
  if (!editor) {
    throw new InstallMcpUsageError(
      `Unknown editor: '${id}'. Pass one of: ${mcpEditorIds.join(" | ")}.`, true
    );
  }
  return editor;
}

/**
 * An answer typed at the prompt: a number off the list, an editor id, or nothing -- nothing
 * means the default, which is why the prompt says [vscode]. Undefined means "not an answer",
 * and the prompt asks again rather than guesses.
 */
export function resolveEditorAnswer(answer: string): McpEditor | undefined {
  const trimmed = answer.trim();
  if (trimmed === "") return findMcpEditor(DEFAULT_EDITOR);
  if (/^\d+$/.test(trimmed)) return mcpEditors[parseInt(trimmed, 10) - 1];
  return findMcpEditor(trimmed);
}

export interface InstallMcpArgs {
  /** The editor named on the command line. Absent: the command asks. */
  editor?: string;
  /** --path: a project root -- install at workspace scope, into the project's own MCP config. */
  path?: string;
  /** --config: write this file instead of the editor's own location. */
  config?: string;
  /** --dry-run: print the resulting configuration instead of writing it. */
  dryRun: boolean;
}

export function parseInstallMcpArgs(args: string[]): InstallMcpArgs {
  const res: InstallMcpArgs = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = (): string => {
      const next = args[++i];
      if (next === undefined || next.indexOf("--") === 0) {
        throw new InstallMcpUsageError(arg + " needs a value");
      }
      return next;
    };
    if (arg === "--config") {
      res.config = value();
    } else if (arg === "--path") {
      res.path = value();
    } else if (arg === "--dry-run") {
      res.dryRun = true;
    } else if (arg.indexOf("--") === 0) {
      throw new InstallMcpUsageError("Unknown option: " + arg);
    } else if (res.editor !== undefined) {
      throw new InstallMcpUsageError(
        "One editor at a time, got: " + res.editor + " and " + arg
      );
    } else {
      requireMcpEditor(arg); // reject a typo here, before the prompt is skipped over it
      res.editor = arg;
    }
  }
  if (res.path !== undefined && res.config !== undefined) {
    throw new InstallMcpUsageError(
      "--path and --config together are ambiguous: --config already names the exact file,\n"
      + "while --path asks the editor's own per-project location to be used. Pass one.", true
    );
  }
  return res;
}

/**
 * The merge itself, pure so it is testable: the existing config text in, the new text out.
 * Read as JSON5 -- Zed's settings.json legitimately holds comments and trailing commas --
 * and written back as plain JSON, since every editor accepts that. Everything already in the
 * file is kept; only the '{@link MCP_SERVER_NAME}' entry is added or replaced.
 */
export function mergeMcpConfig(existing: string | undefined, editor: McpEditor): string {
  let config: { [key: string]: any } = {};
  if (existing !== undefined && existing.trim() !== "") {
    try {
      config = parse(existing);
    } catch (error) {
      throw new InstallMcpUsageError(
        `The existing config is not valid JSON: ${error instanceof Error ? error.message : error}\n`
        + "Fix or remove the file and re-run.", true
      );
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new InstallMcpUsageError(
        "The existing config is not a JSON object, so there is nothing to merge into.\n"
        + "Fix or remove the file and re-run.", true
      );
    }
  }
  const servers = typeof config[editor.serversKey] === "object" && !!config[editor.serversKey]
    && !Array.isArray(config[editor.serversKey])
    ? config[editor.serversKey]
    : {};
  config[editor.serversKey] = servers;
  servers[MCP_SERVER_NAME] = editor.entry;
  return JSON.stringify(config, null, 2) + "\n";
}

/** One question at the prompt, promisified. */
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/** The interactive route: list the editors, take a number or a name, default to vscode. */
async function askEditor(): Promise<McpEditor> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Which code editor should the SurveyJS MCP server be installed for?\n");
    mcpEditors.forEach((editor, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${editor.id.padEnd(16)} ${editor.name}`);
    });
    for (;;) {
      const answer = await question(rl, `\nEditor (number or name) [${DEFAULT_EDITOR}]: `);
      const editor = resolveEditorAnswer(answer);
      if (!!editor) return editor;
      console.log(`'${answer.trim()}' is not on the list -- type a number 1-${mcpEditors.length} or an editor name.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * The file the install writes: --config names it outright, --path asks for the editor's
 * per-project config under a project root, and without either it is the editor's user-scope
 * location. The --path route is checked here -- the root has to exist, and the editor has to
 * have a workspace config at all -- so a typo fails before anything is merged.
 */
function installTarget(args: InstallMcpArgs, editor: McpEditor): string {
  if (args.config !== undefined) return path.resolve(args.config);
  if (args.path === undefined) return editor.configPath(defaultEnvironment());
  const root = path.resolve(args.path);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new InstallMcpUsageError(
      `--path: no such directory: ${root}\n`
      + "It is the project root the workspace config is written under, so it has to exist.", true
    );
  }
  if (!editor.workspaceConfigPath) {
    throw new InstallMcpUsageError(
      `${editor.name} has no per-project MCP config, so --path has nothing to write: it reads `
      + "its servers from one user-scope file. Re-run without --path to install there.\n"
      + `Editors --path works for: ${workspaceMcpEditorIds.join(" | ")}.`, true
    );
  }
  return editor.workspaceConfigPath(root);
}

export async function runInstallMcp(args: InstallMcpArgs): Promise<number> {
  const editor = args.editor !== undefined ? requireMcpEditor(args.editor) : await askEditor();
  const file = installTarget(args, editor);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  const merged = mergeMcpConfig(existing, editor);

  if (args.dryRun) {
    console.log(`${editor.name}: '${MCP_SERVER_NAME}' (${MCP_SERVER_URL}) would be written to ${file}:\n`);
    console.log(merged);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, merged, "utf8");
    console.log(
      `${editor.name}: '${MCP_SERVER_NAME}' MCP server (${MCP_SERVER_URL}) `
      + `${existing !== undefined ? "updated in" : "added to"} ${file}`
    );
  }
  const note = args.path !== undefined && !!editor.workspaceNote ? editor.workspaceNote : editor.note;
  if (!!note) console.log("\n" + note);
  return 0;
}
