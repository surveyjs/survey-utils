# Prompt: absorb surveyjs-doc-generator into survey-utils

## Goal

Copy the code of **`C:\survey.js\Lib\surveyjs-doc-generator`** into **survey-utils** and expose everything
it does through one CLI, so that consumers can eventually invoke it from their `package.json`:

```jsonc
// survey-core/package.json — the target, applied later, NOT by this prompt
"doc_gen": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --md --json-definition"
```

The point is **one build-time tool dependency, not two**. Today survey-core and the three survey-creator
packages each carry `surveyjs-doc-generator` as a `git+https` devDependency, and survey-utils sits beside
it. The end state is a single `survey-utils` devDependency owning API-doc generation, the JSON schema
definition, localization checks, and (see `01-schema-and-llm-guide.md`) the LLM authoring guide.

## Scope — survey-utils only

This prompt changes **nothing outside survey-utils**.

- **Out of scope:** editing any consumer's `package.json`, deleting their `doc_generator/` wrappers,
  touching CI, or archiving the surveyjs-doc-generator repo. Those are done manually, repo by repo, after
  survey-utils is proven.
- **surveyjs-doc-generator stays alive and untouched.** It keeps working for every current consumer while
  survey-utils grows the same capability alongside it. It is retired only once every repo has migrated and
  its CI is green — there is no rush, and no window where a consumer has neither.
- Therefore this is a **copy, not a cutover**. Do not delete anything from the old repo, and do not remove
  a capability from the ported code just because you think nobody uses it (see the JSON-definition note
  below — keep both producers).

The consumer table below exists so the CLI's shape is right for the repos that will adopt it later. It is
context, not a work list.

## What exists today — read this before touching anything

**surveyjs-doc-generator** (1537 LOC, actively developed — md generation landed 2026-07-09):

```
index.ts                 -> re-exports setJsonObj, generateDocumentation, generateMDFiles
index.js                 -> COMMITTED esbuild bundle; this is what `main` points at
src/visitor.ts           -> TS AST walk
src/ast-utils.ts         -> node helpers
src/inheritance.ts       -> base-class resolution
src/serializer.ts        -> joins AST members to Serializer metadata  <-- has the TS5 landmine
src/json-definition.ts   -> JSON definition emission
src/md-generator.ts      -> markdown API docs
src/event-docs.ts, context.ts, state.ts, options.ts, file-utils.ts, types.ts, vue-files.ts
tests/                   -> vitest, 6 specs + fixtures
```

**Consumers** (all via `"surveyjs-doc-generator": "git+https://github.com/surveyjs/surveyjs-doc-generator.git"`):

| Repo / package | Script | Wrapper |
| --- | --- | --- |
| survey-library / survey-core | `doc_gen` | `doc_generator/lib_docgenerator.js` (calls `setJsonObj(Survey.Serializer)`) |
| survey-creator / survey-creator-core | `doc_gen` | `doc_generator/editor_docgenerator.js` (no serializer) |
| survey-creator / survey-creator-js | `doc:gen` | same wrapper |
| survey-creator / survey-creator-react | `doc:gen` | same wrapper |

survey-pdf and survey-analytics may be consumers too — the commented-out blocks in `lib_docgenerator.js`
suggest they were wired up at some point, and neither repo is checked out here. That matters for the
manual rollout later, not for this prompt; the CLI just needs to handle the same entry-file + optional-
serializer shape those repos would use.

Also relevant: survey-core ships `docs/generate_definition.js`, a 6-line script calling
`Serializer.generateSchema()`. The CLI's `--json-definition` reproduces it, but **do not delete it** — it
is consumer-side, and it keeps working until survey-core is migrated by hand.

## What the generator already produces — the four emitters

`generateDocumentation(fileNames, tsOptions, docOptions)` builds one doc model and then picks an output
based on `docOptions`. Understand this before designing flags, because **today the outputs are mutually
exclusive in a way the CLI must fix**:

| Output | Triggered by | Writes | Notes |
| --- | --- | --- | --- |
| Intermediate JSON | *default* (`generateMDFiles !== true`) | `docs/classes.json`, `docs/pmes.json` | The raw doc model: `DocEntry[]` × 2 |
| Markdown API docs | `generateMDFiles: true` | `docs/api/<ClassName>.md` + `docs/api/index.md` | **Replaces** the JSON output — see `generator.ts:68-83`, it is an `if/else` |
| JSON definition | `generateJSONDefinition: true` | `docs/surveyjs_definition.json` | Built from the **AST**, not the runtime serializer — see the conflict below |
| *(new)* LLM guide | `--llm-guide` | see `01-schema-and-llm-guide.md` | A third emitter over the same model |

The `if/else` in `generator.ts` means you cannot currently get markdown *and* the JSON model from one run.
The CLI must make every emitter **independently selectable**: build the model once, then run whichever
emitters were requested.

**`md-generator.ts` (337 LOC) is in good shape — reuse it, do not rewrite it.** It already provides:

- one `<ClassName>.md` per class/interface + an `index.md`, ordered by member count;
- YAML front matter — `title`, `product`, `api-type`, `description`, `source` — with a real
  `yamlScalar()` quoter;
- product auto-detection from the entry path (`detectProduct`: Form Library / Survey Creator / Dashboard /
  PDF Generator) and `sourceUrl(product, className, baseUrl)` producing
  `https://surveyjs.io/<library>/documentation/api-reference/<classname>` — **`index.md` already emits
  `.md` links**;
- `firstSentence()` / `stripMarkdownLinks()` JSDoc summary extraction;
- member filtering via `isVisibleMember()` (not hidden, not protected, has a description);
- inheritance chains, Properties/Methods/Events sections, `**Related APIs:**` from `@see` tags.

`MDGenerationOptions` (`product`, `fileNames`, `outputDir`, `sourceBaseUrl`) is what the CLI flags map onto.

Note `seeNames()` carries a **TypeScript 4.2 workaround** — it strips a trailing `*` that 4.2 appended to
`@see` tag text. Verify on TS 5.7 whether that artifact still occurs; if not, the workaround is harmless
but should be commented as version-conditional rather than silently kept.

## The `surveyjs_definition.json` conflict — resolve before writing the flag

There are **two producers of the same filename, with different contents**, both on disk today:

| Producer | Method | Output | Size |
| --- | --- | --- | --- |
| doc-generator `generateJSONDefinition` (`json-definition.ts`) | walks the **AST** (`addClassIntoJSONDefinition`) | `survey-library/docs/surveyjs_definition.json` | 137,954 B |
| survey-core `docs/generate_definition.js` | **runtime** `Serializer.generateSchema()` | `survey-core/docs/surveyjs_definition.json` | 110,850 B |

Both stamp draft-07 and the title "SurveyJS Library json schema", so they *look* interchangeable and are
not. `--json-definition` maps to the **runtime `Serializer.generateSchema()`** one: it reflects what the
library actually serializes, and it is what this work was asked for.

**Keep the AST producer too.** Port `json-definition.ts` as-is and expose it as `--json-definition=ast`
(default: `runtime`). Nobody has yet established who consumes the 137 KB file — surveyjs.io may serve it,
and a schema quietly shrinking by 27 KB is not a change to make on an assumption. Deciding its fate is part
of the manual rollout; this prompt only has to make sure the capability does not get lost in the move.

## The CLI contract

One `bin` named `survey-utils`, subcommands underneath it. Existing entry points become subcommands so
there is one way in, not three.

```
survey-utils generate-doc <entry...> [options]

  <entry...>                One or more TS entry files, relative to CWD
                            (survey-core: ./entries/chunks/model.ts, creator: src/entries/index.ts)

  --serializer <path>       Module to require for Serializer metadata (e.g. ./build/survey.core).
                            OPTIONAL — survey-creator generates docs without one. When absent,
                            emit AST/JSDoc docs only and skip every serializer-derived section.

  Emitters — independently selectable; at least one required:
  --md                      Markdown API docs: <ClassName>.md per class + index.md  (generateMDFiles)
  --json                    The raw doc model: classes.json + pmes.json
  --json-definition         The JSON Schema from Serializer.generateSchema(). Requires --serializer;
                            error out clearly when it is missing.
  --llm-guide               The LLM authoring guide (see 01-schema-and-llm-guide.md).

  Markdown options (map onto MDGenerationOptions):
  --product <name>          Front-matter product. Default: detectProduct() from the entry path.
  --md-out <dir>            Default: <out>/api
  --source-base-url <url>   Default: https://surveyjs.io

  --out <dir>               Output root. Default: ./docs (today's behaviour).
  --check                   Generate in memory, diff against what is on disk, exit 1 if they differ.

survey-utils check-strings [product]      # today's check:unused-strings
```

These are the commands the consumer scripts will eventually run (**applied manually, later — not by this
prompt**). They are the acceptance targets for the CLI:

```jsonc
// survey-core
"doc_gen": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --md --json-definition --llm-guide"
// survey-creator-core (no serializer -> no schema, no guide)
"doc_gen": "survey-utils generate-doc src/entries/index.ts --md"
```

Require an explicit emitter flag rather than inheriting doc-generator's implicit default (markdown-or-JSON
depending on one boolean). The consumer scripts are being rewritten by hand anyway, so clarity beats
bug-compatibility — but say so in the error when no emitter is passed.

Paths resolve against **CWD**, not against the survey-utils install location: consumers run this from their
own package directory. `lib_docgenerator.js` fakes that today with `process.chdir()`; the CLI does it
honestly, and the wrapper simply stops being needed. (Deleting those wrappers is the consumers' business,
not this prompt's.)

Keep the programmatic API exported as well — `generateDocumentation`, `generateMDFiles`, `setJsonObj` —
with the same signatures, so a consumer can migrate the dependency without rewriting its wrapper in the same
step. A drop-in swap must be possible even though the CLI is the preferred route.

## Expose the doc model

The emitters currently reach into `ctx.outputClasses` / `ctx.outputPMEs` from inside `generateDocumentation`.
Pull the model construction out — `buildModel(fileNames, tsOptions): { classes: DocEntry[], pmes: DocEntry[] }` —
so the CLI can build once and fan out to the requested emitters, and so the LLM-guide emitter consumes
structured `DocEntry` data rather than scraping generated markdown. Have `generateDocumentation` return the
model too; it currently returns `void`, and callers have no way to get it without reading `classes.json` back
off disk.

## The TypeScript 5 port — the part that can fail silently

survey-utils is on **typescript ^5.7.0**; doc-generator pins **4.2.4**. The code must move to 5.7.

`src/serializer.ts:264-267` does:

```ts
if (!Array.isArray(node.decorators)) return false;
for (var i = 0; i < node.decorators.length; i++) {
  const decor = node.decorators[i];
```

**`node.decorators` was removed in TypeScript 5.0.** Under 5.7 it is `undefined`, so this returns
`false` for every node — no crash, no error, just a doc model that quietly loses every `@property()`-
declared member. Since survey-core declares most of its serializable properties that way, the docs
would come out looking plausible and be badly incomplete. Port it to:

```ts
const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
```

Audit the same way for `node.modifiers` (use `ts.canHaveModifiers` / `ts.getModifiers`) and anything
else in the `ts.*` surface that 4.2 allowed and 5.x moved. Do not assume the decorator hit is the only
one — grep the AST code and check each `ts.` API against the 5.x typings, and let `strict: true` +
`tsc` do the rest of the work.

**This is why the golden-output test below is not optional.**

## Acceptance test: byte-identical output

This is the whole safety story. The TS 5 port can degrade the docs *silently* (see above), so the only
thing standing between a bad port and bad docs is a baseline diff. Prove the ported generator produces the
*same docs as today*:

1. In survey-core, run the **current** pipeline (`npm run doc_gen`, old generator, TS 4.2.4) and copy
   `docs/` to a golden snapshot.
2. Run the **new** CLI: `survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --json-definition`.
3. Diff. It must be **byte-identical** — or every difference must be explained and deliberate.
4. Repeat for survey-creator-core (`src/entries/index.ts`, no `--serializer`).

Commit the comparison as a test fixture if practical; at minimum, record the result in the PR. A diff
that shows *fewer properties* than the golden run means the decorator port is wrong.

## Making survey-utils installable as a git dependency

Consumers install from `git+https://github.com/surveyjs/survey-utils.git`, so the package must work
without a registry publish:

- Add `"bin": { "survey-utils": "./dist/cli.js" }` with a `#!/usr/bin/env node` shebang.
- npm runs `prepare` for git dependencies (and installs devDeps to do it), so add
  `"prepare": "npm run build"` — that compiles `dist/` at install time. Prefer this over committing
  `dist/`; doc-generator committed its bundle only because it had no build-on-install step. Keep
  `prepublishOnly` as is.
- `files` already lists `dist/**/*`; add anything else the CLI reads at runtime.
- Move `typescript` and `jsdom` to `dependencies` (they already are) — the CLI needs them at consumer
  install time, not just to build.

Verify by installing the git URL into a scratch package and running the bin, **before** touching any
consumer.

## Order of work (all inside survey-utils, each step independently revertible)

1. **Capture the golden baseline first**, from the *current* generator at TS 4.2.4, while it is still
   installed and working. Two runs are needed, because the outputs are mutually exclusive today: `doc_gen`
   for `classes.json`/`pmes.json`, and `lib_mdgenerator.js` (which passes `generateMDFiles: true`) for the
   markdown. Do survey-core and survey-creator-core both. Store the snapshot; the port is judged against it.
2. Copy the code into `src/doc-gen/`, port to TS 5.7 strict, port the vitest specs to jest (survey-utils
   uses jest/ts-jest — do not add a second test runner). Reuse `src/shared/dom.ts` (`installDom()`) before
   requiring the survey-core bundle, instead of hoping the bundle does not touch `document`.
3. Extract `buildModel()`, add `cli.ts` + the `bin`, wire up the emitters.
4. Reproduce the golden baseline byte-for-byte.
5. Point-test git-installability: install survey-utils from its git URL into a scratch package and run the
   bin. Do not touch a real consumer to test this.

Done means: survey-utils can generate everything doc-generator generates, byte-identically, from one CLI,
installed from a git URL — with every consumer still happily using the old package.

## Constraints

- TypeScript strict, matching survey-utils' existing `tsconfig.json`. No new test runner, no esbuild —
  `tsc` to `dist/` like the rest of the repo.
- Do not "improve" the doc generator while moving it. Port, prove byte-identical, land. Behaviour
  changes come after, as separate commits, or you will never know which change broke the docs.
- Do not modify survey-core/survey-creator source to suit the generator.
- Keep the git history of the moved code if the tooling allows (`git subtree`/`git filter-repo` into a
  branch), so `git log`/`blame` on `src/doc-gen/` still tells you why a line exists.
