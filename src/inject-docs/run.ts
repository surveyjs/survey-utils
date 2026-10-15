import * as fs from "fs";
import * as path from "path";
import type { InjectMarkdownResult, InjectMessage } from "inject-markdown";
import { PathError } from "../paths";
import { injectTopicPaths, PATHS_FILE, siteRoot } from "../site-paths";
import { loadInjectMarkdown } from "./load";

export interface InjectDocsOptions {
  /**
   * The topics to refresh, as the caller typed them: resolved against the content repo root,
   * absolute ones taken as they stand. Empty: paths.json's `site.injectTopics`.
   */
  topics: string[];
  /** --out: the content repo root, resolved like the -site presets' one. Absent: the sibling checkout. */
  out?: string;
  /** Process in memory and report the stale topics, without touching the files. */
  check?: boolean;
}

/** A section inject-markdown filled with failure text, found by findSilentFailures. */
export interface SilentFailure {
  /** The directive's reference, as it reads in the comment: the section has no line of its own. */
  reference: string;
  /** What the section holds instead of the content. */
  found: string;
}

/** A topic resolved against the content repo, and where the caller got it from. */
interface Topic {
  file: string;
  /** Named on the command line: a missing one is the caller's mistake, not the branch's state. */
  named: boolean;
}

interface Processed {
  file: string;
  before: string;
  result: InjectMarkdownResult;
  /** Every reason the result cannot be accepted, already formatted for the report. */
  failures: string[];
}

/** An `@@inject...` comment: the opening directives and the end marker share the grammar. */
const DIRECTIVE = /^[ \t]*<!--+\s*@@inject(|-start|-end|-code|-table)[:\s]\s*(.*?)\s*-+->\s*$/;
const HEADER_NOT_FOUND = /<!--+\s*header: "(.*)" not found\./;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * The failures inject-markdown 6.2.0 writes into the document without reporting them.
 *
 * In each case the section is replaced with failure text and the result says `updated: true`
 * with no error, so an accepted result would overwrite good content with it and `--check` would
 * pass on a broken doc:
 *
 * - a `heading=` that matches nothing becomes `<!--- header: "<text>" not found.  --->`;
 * - a remote reference that answers 404 becomes a fenced block holding `404: Not Found` -- the
 *   fetch does not look at the status. With a line range (`#L5-L23`, which every GitHub
 *   permalink in the site's topics has) the range is cut from that one-line body, and what is
 *   left is an empty fenced block.
 *
 * Only the text between a directive and its end marker is looked at: the same words elsewhere
 * in a topic are the topic's own. This only refuses such output, it never repairs it. Delete
 * it once inject-markdown reports these itself.
 */
export function findSilentFailures(content: string): SilentFailure[] {
  const failures: SilentFailure[] = [];
  let reference: string | undefined = undefined;
  let fence: string | undefined = undefined;
  let body: string[] = [];
  content.split(/\r?\n/).forEach((line) => {
    // Fences are followed everywhere, not only in sections: a directive quoted in a code block
    // is not one, and inject-markdown, which parses the Markdown, does not take it for one.
    if (!!fence) {
      if (line.trim().indexOf(fence) === 0 && line.trim().replace(/[`~]/g, "") === "") {
        const text = body.join("\n").trim();
        if (reference !== undefined && text === "") {
          failures.push({ reference, found: "an empty code block" });
        }
        if (reference !== undefined && text === "404: Not Found") {
          failures.push({ reference, found: "a code block holding \"404: Not Found\"" });
        }
        fence = undefined;
      } else {
        body.push(line);
      }
      return;
    }
    const directive = DIRECTIVE.exec(line);
    if (!!directive) {
      // An end marker closes the section whatever it names; a new opener starts the next one.
      reference = directive[1] === "-end" ? undefined : directive[2];
      return;
    }
    const open = FENCE.exec(line);
    if (!!open) {
      fence = open[1];
      body = [];
      return;
    }
    const notFound = reference !== undefined ? HEADER_NOT_FOUND.exec(line) : null;
    if (!!notFound) failures.push({ reference: reference!, found: `header "${notFound[1]}" not found` });
  });
  return failures;
}

/**
 * A diagnostic, located as precisely as inject-markdown located it. `line` and `column` are
 * optional in its types and a read failure comes without them, so a missing one drops the
 * coordinates rather than print them as `undefined`.
 */
export function formatMessage(file: string, message: InjectMessage): string {
  const at = message.line !== undefined
    ? `${file}:${message.line}` + (message.column !== undefined ? `:${message.column}` : "")
    : file;
  return `${at}: ${message.message}`;
}

/**
 * The topics a run processes. Named ones are resolved against the content repo, the way an
 * entry file is resolved against --path, so `Docs/x.md` means the same thing from any working
 * directory; one that is not there is the caller's typo. The paths.json ones are a default
 * nobody typed, and a branch that has not got one yet is a normal state of an upstream repo --
 * reported and skipped, as the token tables do.
 */
function resolveTopics(root: string, named: string[]): Topic[] {
  if (named.length > 0) {
    return named.map((topic) => {
      const file = path.resolve(root, topic);
      if (!fs.existsSync(file)) {
        throw new PathError(
          `Topic not found: ${file}\n  --out: ${root}\n  topic: ${topic}\n`
          + "A topic is resolved against --out, the content repo root, so name it relative to that."
        );
      }
      return { file, named: true };
    });
  }
  const topics: Topic[] = [];
  injectTopicPaths().forEach((topic) => {
    const file = path.resolve(root, topic);
    if (fs.existsSync(file)) topics.push({ file, named: false });
    else console.warn(`warning: no topic at ${file} (site.injectTopics in ${PATHS_FILE}) -- skipped.`);
  });
  return topics;
}

/**
 * Refresh the `@@inject` sections of the site's topics with inject-markdown: shared Markdown
 * from DocsShared, and code from GitHub permalinks -- so the run needs the network.
 *
 * A run is all or nothing. Every topic is processed in memory first, and every failure in every
 * one of them is collected; only a run with none writes anything. A broken source therefore never
 * overwrites the last good content, and a failed run never leaves the content repo half-updated.
 * `--check` stops after the first phase and reports the topics that are out of date.
 *
 * It is a command of its own rather than part of a -site preset: these topics depend on no
 * product build, only on the content repo itself and the external repos it quotes.
 *
 * Resolves to the exit code: 1 when anything failed, or under --check when anything is stale.
 */
export async function runInjectDocs(options: InjectDocsOptions): Promise<number> {
  const root = siteRoot(options.out);
  if (!fs.existsSync(root)) {
    throw new PathError(
      `Content repo not found: ${root}\n--out must name the root of the checkout, the folder `
      + "the topics' paths are relative to."
    );
  }
  const topics = resolveTopics(root, options.topics);
  const { injectMarkdown } = await loadInjectMarkdown();

  // Phase 1: everything in memory. A topic that fails does not stop the rest, so one run
  // reports every failure there is before it gives up writing.
  const processed: Processed[] = [];
  for (const topic of topics) {
    const before = fs.readFileSync(topic.file, "utf8");
    // `file` absolute: a relative one is resolved against `cwd` a second time. `cwd` is the repo
    // root, not the topic's folder, because references go up and across (Docs/ -> ../DocsShared/)
    // and must still be refused when they leave the repo. strictVars, because without it an
    // unresolved {@ name @} is only a warning and is published as it stands.
    const result = await injectMarkdown(
      { file: topic.file, content: before },
      { cwd: root, strictVars: true }
    );
    // Warnings count as failures: a publish has no use for a doc the library had to warn about,
    // and a file it could not read is reported as one.
    const failures = [
      ...result.errors.map((error) => formatMessage(topic.file, error)),
      ...result.warnings.map((warning) => "warning: " + formatMessage(topic.file, warning)),
      ...findSilentFailures(result.document.content)
        .map((failure) => `${topic.file}: ${failure.reference}: ${failure.found}`)
    ];
    failures.forEach((failure) => console.error(failure));
    processed.push({ file: topic.file, before, result, failures });
  }

  // Phase 2: decide for the whole run at once.
  const failed = processed.filter((topic) => topic.failures.length > 0);
  const stale = processed.filter((topic) => topic.failures.length === 0 && topic.result.updated);
  const write = !options.check && failed.length === 0;
  processed.forEach((topic) => {
    const status = topic.failures.length > 0 ? `${topic.failures.length} failure(s)`
      : !topic.result.updated ? "unchanged"
        : write ? "written" : "differs";
    console.log(`${topic.file}: ${status}`);
  });
  if (write) stale.forEach((topic) => fs.writeFileSync(topic.file, topic.result.document.content));

  const count = `${processed.length} topic(s) ${options.check ? "checked" : "processed"}`;
  if (failed.length > 0) {
    console.log(`${count}, ${failed.length} failed -- nothing written.`);
    return 1;
  }
  if (options.check) {
    console.log(`${count}, ${stale.length} differ from their sources.`);
    return stale.length > 0 ? 1 : 0;
  }
  console.log(`${count}, ${stale.length} written.`);
  return 0;
}
