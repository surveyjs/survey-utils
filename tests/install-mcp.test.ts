import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEFAULT_EDITOR, InstallMcpUsageError, MCP_SERVER_NAME, MCP_SERVER_URL, McpEnvironment,
  findMcpEditor, mcpEditorIds, mcpEditors, mergeMcpConfig, parseInstallMcpArgs,
  resolveEditorAnswer, runInstallMcp
} from "../src/install-mcp";

// ---------------------------------------------------------------------------
// The editor table

test("the table covers the ten supported editors, vscode first because it is the default", () => {
  expect(mcpEditors.length).toBe(10);
  expect(mcpEditors[0].id).toBe(DEFAULT_EDITOR);
  expect(mcpEditorIds).toEqual([
    "vscode", "vscode-insiders", "cursor", "windsurf", "webstorm",
    "visual-studio", "claude-code", "claude-desktop", "zed", "cline"
  ]);
});

test("every editor id is unique -- the prompt numbers and the CLI names both key off it", () => {
  expect(new Set(mcpEditorIds).size).toBe(mcpEditorIds.length);
});

test("every editor entry points at the SurveyJS MCP server, directly or through mcp-remote", () => {
  mcpEditors.forEach((editor) => {
    const direct = JSON.stringify(editor.entry).indexOf(MCP_SERVER_URL) >= 0;
    expect(direct ? "ok" : editor.id).toBe("ok");
  });
});

test("findMcpEditor is case-insensitive and returns nothing for a stranger", () => {
  expect(findMcpEditor("WebStorm")?.id).toBe("webstorm");
  expect(findMcpEditor("emacs")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Config-file locations, per OS

const win: McpEnvironment = {
  platform: "win32",
  home: "C:\\Users\\dev",
  env: { APPDATA: "C:\\Users\\dev\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" }
};
const mac: McpEnvironment = { platform: "darwin", home: "/Users/dev", env: {} };
const linux: McpEnvironment = { platform: "linux", home: "/home/dev", env: {} };

function configPath(id: string, env: McpEnvironment): string {
  const editor = findMcpEditor(id);
  expect(editor).toBeDefined();
  return editor!.configPath(env);
}

test("vscode's config is the user-profile mcp.json, at each OS's convention", () => {
  expect(configPath("vscode", win))
    .toBe(path.join("C:\\Users\\dev\\AppData\\Roaming", "Code", "User", "mcp.json"));
  expect(configPath("vscode", mac))
    .toBe(path.join("/Users/dev", "Library", "Application Support", "Code", "User", "mcp.json"));
  expect(configPath("vscode", linux))
    .toBe(path.join("/home/dev", ".config", "Code", "User", "mcp.json"));
});

test("linux honors XDG_CONFIG_HOME when it is set", () => {
  const xdg: McpEnvironment = { ...linux, env: { XDG_CONFIG_HOME: "/xdg" } };
  expect(configPath("vscode", xdg)).toBe(path.join("/xdg", "Code", "User", "mcp.json"));
});

test("cursor and claude-code keep their config under the home directory on every OS", () => {
  expect(configPath("cursor", win)).toBe(path.join("C:\\Users\\dev", ".cursor", "mcp.json"));
  expect(configPath("cursor", linux)).toBe(path.join("/home/dev", ".cursor", "mcp.json"));
  expect(configPath("claude-code", mac)).toBe(path.join("/Users/dev", ".claude.json"));
});

test("webstorm's Copilot config is local (not roaming) on Windows, ~/.config elsewhere", () => {
  expect(configPath("webstorm", win)).toBe(
    path.join("C:\\Users\\dev\\AppData\\Local", "github-copilot", "intellij", "mcp.json")
  );
  expect(configPath("webstorm", mac)).toBe(
    path.join("/Users/dev", ".config", "github-copilot", "intellij", "mcp.json")
  );
});

test("visual-studio reads the global .mcp.json in the user profile", () => {
  expect(configPath("visual-studio", win)).toBe(path.join("C:\\Users\\dev", ".mcp.json"));
});

test("windows locations fall back to the conventional folders when the variables are unset", () => {
  const bare: McpEnvironment = { platform: "win32", home: "C:\\Users\\dev", env: {} };
  expect(configPath("vscode", bare))
    .toBe(path.join("C:\\Users\\dev", "AppData", "Roaming", "Code", "User", "mcp.json"));
  expect(configPath("webstorm", bare))
    .toBe(path.join("C:\\Users\\dev", "AppData", "Local", "github-copilot", "intellij", "mcp.json"));
});

// ---------------------------------------------------------------------------
// The merge

const vscode = findMcpEditor("vscode")!;

test("no existing config: the file holds nothing but the servers key and the entry", () => {
  const merged = JSON.parse(mergeMcpConfig(undefined, vscode));
  expect(merged).toEqual({ servers: { [MCP_SERVER_NAME]: { type: "http", url: MCP_SERVER_URL } } });
});

test("everything already in the config survives the merge; only the surveyjs entry is written", () => {
  const existing = JSON.stringify({
    inputs: [{ id: "token" }],
    servers: { other: { command: "node", args: ["server.js"] } }
  });
  const merged = JSON.parse(mergeMcpConfig(existing, vscode));
  expect(merged.inputs).toEqual([{ id: "token" }]);
  expect(merged.servers.other).toEqual({ command: "node", args: ["server.js"] });
  expect(merged.servers[MCP_SERVER_NAME]).toEqual({ type: "http", url: MCP_SERVER_URL });
});

test("an existing surveyjs entry is replaced, so re-running is how a stale URL is fixed", () => {
  const existing = JSON.stringify({ servers: { surveyjs: { type: "http", url: "https://old.example" } } });
  const merged = JSON.parse(mergeMcpConfig(existing, vscode));
  expect(merged.servers.surveyjs.url).toBe(MCP_SERVER_URL);
});

test("the existing config is read as JSON5 -- Zed's settings.json legitimately holds comments", () => {
  const zed = findMcpEditor("zed")!;
  const existing = `{
    // the theme comes first
    "theme": "One Dark",
    "context_servers": { "other": { "command": "foo" }, },
  }`;
  const merged = JSON.parse(mergeMcpConfig(existing, zed));
  expect(merged.theme).toBe("One Dark");
  expect(merged.context_servers.other).toEqual({ command: "foo" });
  expect(merged.context_servers.surveyjs.command).toBe("npx");
  expect(merged.context_servers.surveyjs.args).toEqual(["-y", "mcp-remote", MCP_SERVER_URL]);
});

test("each editor's spelling of a remote server is the one its config format wants", () => {
  expect(JSON.parse(mergeMcpConfig(undefined, findMcpEditor("cursor")!)).mcpServers.surveyjs)
    .toEqual({ url: MCP_SERVER_URL });
  expect(JSON.parse(mergeMcpConfig(undefined, findMcpEditor("windsurf")!)).mcpServers.surveyjs)
    .toEqual({ serverUrl: MCP_SERVER_URL });
  expect(JSON.parse(mergeMcpConfig(undefined, findMcpEditor("cline")!)).mcpServers.surveyjs)
    .toEqual({ url: MCP_SERVER_URL, type: "streamableHttp" });
  expect(JSON.parse(mergeMcpConfig(undefined, findMcpEditor("claude-desktop")!)).mcpServers.surveyjs)
    .toEqual({ command: "npx", args: ["-y", "mcp-remote", MCP_SERVER_URL] });
});

test("a config that will not parse is reported, not overwritten", () => {
  expect(() => mergeMcpConfig("{ not json", vscode)).toThrow(InstallMcpUsageError);
  expect(() => mergeMcpConfig("{ not json", vscode)).toThrow(/not valid JSON/);
});

test("a config that parses to a non-object is rejected the same way", () => {
  expect(() => mergeMcpConfig("[1, 2]", vscode)).toThrow(/not a JSON object/);
});

test("an empty or whitespace-only file merges like a missing one", () => {
  expect(JSON.parse(mergeMcpConfig("  \n", vscode)))
    .toEqual(JSON.parse(mergeMcpConfig(undefined, vscode)));
});

// ---------------------------------------------------------------------------
// Argument parsing

test("the editor is the one positional argument, checked before the prompt is skipped over it", () => {
  expect(parseInstallMcpArgs(["webstorm"]).editor).toBe("webstorm");
  expect(parseInstallMcpArgs([]).editor).toBeUndefined();
  expect(() => parseInstallMcpArgs(["emacs"])).toThrow(InstallMcpUsageError);
  expect(() => parseInstallMcpArgs(["emacs"])).toThrow(new RegExp(mcpEditorIds.join(" \\| ")));
  expect(() => parseInstallMcpArgs(["vscode", "cursor"])).toThrow(/One editor at a time/);
});

test("--config and --dry-run parse; a stray option is rejected", () => {
  const args = parseInstallMcpArgs(["vscode", "--config", "some/mcp.json", "--dry-run"]);
  expect(args.config).toBe("some/mcp.json");
  expect(args.dryRun).toBe(true);
  expect(() => parseInstallMcpArgs(["--config"])).toThrow(/--config needs a value/);
  expect(() => parseInstallMcpArgs(["--force"])).toThrow(/Unknown option/);
});

// ---------------------------------------------------------------------------
// The prompt's answers

test("an empty answer is the default, a number picks off the list, a name is a name", () => {
  expect(resolveEditorAnswer("")?.id).toBe(DEFAULT_EDITOR);
  expect(resolveEditorAnswer("  ")?.id).toBe(DEFAULT_EDITOR);
  expect(resolveEditorAnswer("3")?.id).toBe(mcpEditors[2].id);
  expect(resolveEditorAnswer("Cursor")?.id).toBe("cursor");
});

test("an answer off the list resolves to nothing, so the prompt asks again", () => {
  expect(resolveEditorAnswer("0")).toBeUndefined();
  expect(resolveEditorAnswer("42")).toBeUndefined();
  expect(resolveEditorAnswer("emacs")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The run, against a --config file in a temp dir

describe("runInstallMcp", () => {
  let dir: string;
  let log: jest.SpyInstance;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-mcp-"));
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    log.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writes the config file, creating the folders on the way", async () => {
    const file = path.join(dir, "deep", "mcp.json");
    expect(await runInstallMcp({ editor: "vscode", config: file, dryRun: false })).toBe(0);
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.servers[MCP_SERVER_NAME]).toEqual({ type: "http", url: MCP_SERVER_URL });
  });

  test("a second run against the same file merges rather than clobbers", async () => {
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, JSON.stringify({ servers: { other: { url: "https://other.example" } } }));
    await runInstallMcp({ editor: "vscode", config: file, dryRun: false });
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written.servers.other).toEqual({ url: "https://other.example" });
    expect(written.servers[MCP_SERVER_NAME].url).toBe(MCP_SERVER_URL);
  });

  test("--dry-run prints the configuration and writes nothing", async () => {
    const file = path.join(dir, "mcp.json");
    expect(await runInstallMcp({ editor: "cursor", config: file, dryRun: true })).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    const printed = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain(MCP_SERVER_URL);
    expect(printed).toContain(file);
  });

  test("a broken existing config fails the run instead of being overwritten", async () => {
    const file = path.join(dir, "mcp.json");
    fs.writeFileSync(file, "{ broken");
    await expect(runInstallMcp({ editor: "vscode", config: file, dryRun: false }))
      .rejects.toThrow(InstallMcpUsageError);
    expect(fs.readFileSync(file, "utf8")).toBe("{ broken");
  });

  test("an unknown editor is rejected by the run too, for callers that skip parseInstallMcpArgs", async () => {
    await expect(runInstallMcp({ editor: "emacs", dryRun: true })).rejects.toThrow(/Unknown editor/);
  });
});
