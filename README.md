# Survey Utils

A utility library for SurveyJS localization and translation management.

## 🚀 Quick Start

Everything the package does is reached through its one bin, `survey-utils`:

```bash
survey-utils translate <product> [--key <key>] [--path <dir>]   # translate localization files
survey-utils check-strings [product] [--list-dead]              # report unused localization strings
survey-utils generate-doc <entry...> [options]                  # generate API docs
survey-utils help                                               # the full option list
```

### From a consumer's package.json

Install the package, then call the bin from `scripts` — npm puts `node_modules/.bin` on the
path, so the bare `survey-utils` name resolves:

```jsonc
// package.json
{
  "devDependencies": {
    "survey-utils": "^1.0.0"
  },
  "scripts": {
    // Takes the key from TRANSLATION_API_KEY; add `--key <key>` to pass it explicitly.
    "translate": "survey-utils translate --path ./src/localization",
    "check:unused-strings": "survey-utils check-strings library",
    "doc_gen": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --md --json-definition"
  }
}
```

```bash
npm run translate -- --key <key>      # the key as a command parameter, e.g. from a CI secret
```

`--path` is what makes `translate` work from a consumer package: without it, the product's
localization folder is looked up next to `survey-utils` — the layout of a local SurveyJS
checkout (see below), which an installed dependency does not have. Don't hard-code the key in
a `scripts` entry: it would be committed, and `$VAR` in a script does not expand on Windows.

### From this repository

`survey-utils` is not on the path here, so run the built bin through `node`. Install and
build first:

```bash
npm i
npm run build

node ./dist/cli.js translate library
node ./dist/cli.js check-strings analytics
```

The `npm run translate`, `npm run check:unused-strings` and `npm run generate-doc` scripts are
thin aliases for those three, and take the same arguments after `--`:

```bash
npm run translate -- creator --key <key>
npm run check:unused-strings -- creator --list-dead
```

### 🌍 Translation

`translate` sends every string that has no translation yet to the Azure Translator API and
writes the result back into the product's locale files.

```bash
node ./dist/cli.js translate library           # survey-core
node ./dist/cli.js translate creator           # survey-creator-core
node ./dist/cli.js translate creator-presets   # survey-creator-core UI presets
node ./dist/cli.js translate analytics         # survey-analytics
```

Each product's localization folder is resolved relative to the SurveyJS checkout root —
the folder that holds `survey-utils`, `survey-library`, `survey-creator` and
`survey-analytics` side by side. `--path <dir>` names the folder outright, resolved against
the working directory, and works with no product at all:

```bash
node ./dist/cli.js translate --path ../survey-library/packages/survey-core/src/localization
```

#### The subscription key

The Azure Translator API needs a subscription key — find it in the Azure portal under your
Translator resource → **Keys and Endpoint**. Give it to the command in either of two ways;
`--key` wins when both are present:

```bash
# 1. As a command parameter -- for a key that lives outside this machine, e.g. a CI secret.
node ./dist/cli.js translate library --key <key>

# 2. From TRANSLATION_API_KEY, in the environment or in a .env file.
cp .env.example .env      # .env is git-ignored and must never be committed
```

```ini
# .env
TRANSLATION_API_KEY=<your Azure Translator subscription key>
```

With neither, the command fails with an explicit error before it translates anything.

### 🧹 Unused-String Check

```bash
node ./dist/cli.js check-strings library     # survey-core
node ./dist/cli.js check-strings creator     # survey-creator-core
node ./dist/cli.js check-strings analytics   # survey-analytics
node ./dist/cli.js check-strings             # every known product
```

Reports localization keys that no product source reaches any more, and exits with code
`1` so CI fails when a newly added string is never used. See
[Unused-String Check (loc-lint)](#-unused-string-check-loc-lint) below.

### 🤖 Survey JSON: the schema and the LLM guide

`generate-doc` emits two artifacts for the survey JSON, both derived from survey-core alone.
**The schema constrains and verifies; the guide teaches.** Generate with the guide, validate
with the schema.

| Artifact | Flag | What it is |
| --- | --- | --- |
| `surveyjs_definition.json` | `--json-definition` | The JSON Schema, from `Serializer.generateSchema()`. Validate JSON that an LLM, a developer or the Creator produced. |
| `llm-guide.md` | `--llm-guide` | The authoring guide you give a model as context so the SurveyJS JSON it writes loads and behaves. Also emits `llms.txt`, listing both. |

```bash
# From packages/survey-core, with the bundle already built:
node ../../../survey-utils/dist/cli.js generate-doc ./entries/chunks/model.ts \
  --serializer ./build/survey.core --llm-guide --json-definition --out ./docs
```

**survey-core must be built first.** The generator reads it twice: the built bundle
(`--serializer ./build/survey.core`) for the metadata — question types, properties, defaults —
and the TypeScript sources under `src/` for the JSDoc. A stale bundle produces a guide that
documents the previous release.

The expression operators come from the sources too, and deliberately so. They are declared as
static object literals inside `expressions.ts` — values in a file, not API members — so
[`operators.ts`](src/doc-gen/operators.ts) reads their names off its AST rather than asking
survey-core to export the internal class that holds them. A documentation generator should not
cost the library a permanent public-API commitment.

The source only supplies the candidate names. Which of them an author may actually write, and how
it is spelled, is settled by `ConditionsParser`, which survey-core already exports: a spelling it
rejects never reaches the guide, so the internal helpers drop out on their own, and `greater` is
reported as `>` because that is what the library renders it as.

Every fact in both files is extracted at generation time. There are **no hand-maintained
tables** of types, properties, descriptions, operators or examples: those rot the moment
survey-core changes, and a stale guide teaches a model to write JSON that no longer loads.
The only fixed prose is a ~10-line block of output rules, in one constant in
[`llm-guide.ts`](src/doc-gen/llm-guide.ts). Every JSON snippet is built through the library's
own API, serialized with `toJSON()`, and then validated, loaded with `new SurveyModel(json)`
and re-serialized — a snippet that fails is never emitted.

#### Wiring `--check` into CI

Generation is deterministic — stable key order, 2-space indent, LF, no timestamps — so two
runs are byte-identical. `--check` regenerates in memory, diffs against what is on disk and
exits `1` when they differ, which fails the build when someone changes survey-core and does
not regenerate:

```bash
node ./dist/cli.js generate-doc ./entries/chunks/model.ts \
  --serializer ./build/survey.core --llm-guide --json-definition --out ./docs --check
```

#### Three things worth knowing

**`generateSchema()` cannot catch an unknown question type.** It never emits a schema for
`elements`, so the per-type definitions it generates are unreachable when a survey is
validated: `{"type": "radio"}` — which is not a SurveyJS type — validates clean. The schema
still checks the survey's own properties and their types. Because of this the generator does
not rely on it alone; it also checks every snippet's `type` strings against
`ElementFactory.getAllTypes()` and round-trips the JSON through `SurveyModel`. Fixing this
properly belongs in survey-core, not here.

**Property ordering is weaker than it could be.** `JsonObjectProperty.category` is the field
that would sort "data/logic" above "appearance", but survey-core never sets it — the
categories live in survey-creator's property grid, and the survey-core-only rule puts them out
of reach. The guide sorts on the proxies that *are* in the library: required first, then
structural properties, then expression-valued ones, then enums, then whatever is documented.
A better signal exists in survey-creator and is deliberately not used.

**The size budget.** The guide is spent from a context window, so every run logs its bytes and
approximate token count, and the run fails above `--max-bytes` (default 96 KB). The question
types, the shared bases and the survey/page shell come to ~57 KB; the triggers, validators and
nested objects an author also has to get right add ~16 KB more. `--split` emits one file per
question type instead, for a reader that retrieves rather than reads it all, and
`--with-member-links` adds member-level API links there.

## 📖 Overview

Survey Utils provides tools for managing localization files, extracting and manipulating comments in JSON translation files, and automating translation workflows for SurveyJS applications.

## ✨ Features

- **🔍 Comment Extraction**: Extract comments from localization files while preserving their position (top/right)
- **📝 JSON Manipulation**: Parse and modify JSON files with comment preservation
- **🌍 Translation Management**: Automate the process of moving auto-generated comments to translation files
- **📘 TypeScript Support**: Full TypeScript support with type definitions
- **🔧 Debug Support**: Built-in VS Code debugging configurations

## 📦 Installation

```bash
npm install survey-utils
```

## 💻 Usage

### Basic Usage

```typescript
import { LocalizationUtils } from 'survey-utils';

const utils = new LocalizationUtils();

// Read comments from a localization file
const comments = utils.readJsonCommentsFromFile('path/to/localization.ts');

// Extract JSON content from a file
const json = utils.getJson(fileContent);

// Replace JSON content while preserving structure
const newContent = utils.replaceJson(originalContent, newJsonString);
```

### Working with Comments

The library can extract comments from localization files in the following format:

```typescript
export var loc = {
  // This is a top comment
  "key1": "value1", // This is a right comment
  "nested": {
    // Another top comment
    "key2": "value2"
  }
};
```

### Batch Operations

```typescript
import { setTranslationKey, translateFile, translateFiles } from 'survey-utils';

// The key `survey-utils translate --key` sets. Optional: without it the API key is
// read from TRANSLATION_API_KEY (environment or .env).
setTranslationKey(process.env.MY_AZURE_KEY);

// Translate every locale file in a directory
translateFiles('/path/to/localization/files');

// Translate a specific file
translateFile('/path/to/localization/german.ts');
```

## 🔧 Development

### Building the Project

```bash
npm run build
```

### Running Tests

```bash
npm test
```

### Debugging

The project includes VS Code debug configurations:

1. **Debug translateLibrary.ts** - Direct TypeScript debugging
2. **Debug translateLibrary.ts (Compiled)** - Debug compiled JavaScript

Or use the command line:
```bash
npm run debug
```

### Project Structure

```
survey-utils/
├── src/
│   ├── index.ts              # Main exports
│   ├── cli.ts                # The `survey-utils` bin: translate, check-strings, generate-doc
│   ├── translate.ts          # Translation command: product paths, --key, --path
│   ├── translateLibrary.ts   # Per-product entry points, kept for the run_translate_*.cmd
│   ├── localization-utils.ts # Core utilities
│   ├── loc-lint/             # Unused-string check
│   └── doc-gen/              # API-doc generator (from surveyjs-doc-generator)
├── tests/
│   ├── translation_utils.test.ts # Unit tests
│   ├── loc-lint.test.ts
│   └── doc-gen/              # Doc-generator specs + fixtures
├── .vscode/
│   ├── launch.json           # Debug configurations
│   └── tasks.json            # Build tasks
├── allowlists/              # Known-dynamic and known-dead strings, per product
├── dist/                    # Built files (generated)
├── package.json             # Package configuration
├── tsconfig.json            # TypeScript configuration
├── jest.config.js           # Jest test configuration
└── README.md                # This file
```

## 🔌 API Reference

### LocalizationUtils

#### Methods

- `readJsonComments(code: string): ICommentInfo[]` - Extract comments from code string
- `readJsonCommentsFromFile(fileName: string): ICommentInfo[]` - Extract comments from file
- `getJson(code: string): any` - Extract JSON object from code
- `replaceJson(code: string, newJson: string): string` - Replace JSON content
- `generateJsonText(json: any, comments: ICommentInfo[], padding?: number): string` - Generate JSON with comments
- `translateFile(fileName: string, englishJSON: any): void` - Translate a specific file

### Package functions

- `setTranslationKey(key: string): void` - Azure Translator subscription key for this process, ahead of `TRANSLATION_API_KEY`. This is what `translate --key` calls.
- `translateFiles(path: string): void` - Translate every locale file in a folder
- `translateFile(fileName: string): void` - Translate one locale file
- `runCheckUnusedStrings(args: string[]): number` - The `check-strings` command
- `generateDocumentation`, `generateMDFiles`, `setJsonObj` - The doc generator

### Interfaces

```typescript
interface ICommentInfo {
  key: string;
  comment: string;
  position: 'top' | 'right';
}

interface IStringToTranslate {
  key: string;
  text: string;
}
```

## 🧹 Unused-String Check (loc-lint)

Finds translated strings that no longer reach the product, and fails CI when a newly
added string is never used.

Known products: **`library`** (survey-core), **`creator`** (survey-creator-core),
and **`analytics`** (survey-analytics). `analytics` also answers to **`dashboard`**, the
name it was registered under first — both spellings select the same product.

```bash
survey-utils check-strings analytics              # verdict + summary
survey-utils check-strings creator --list-dead    # print the cleanup backlog
survey-utils check-strings                        # every known product
survey-utils check-strings dashboard              # the alias, kept for old scripts
```

```
library:   0 new unused string(s), 0 known dead, 0 dynamic exemption(s).
creator:   0 new unused string(s), 0 known dead, 5 dynamic exemption(s).
analytics: 0 new unused string(s), 0 known dead, 0 dynamic exemption(s).
```

The five exemptions are `dynamic:` keys built at runtime (e.g. `getLocString("ed." + state)`).
If a run ever shows `N known dead`, those are strings recorded with a `baseline:` reason
that are already unused and waiting to be deleted; `--list-dead` prints them grouped by
namespace.

**Exit code 1 — the build should fail** when a *new* unused string appears, when an
allowlist entry rots, or when a dynamic namespace loses its resolver. Strings already
recorded as `baseline:` are reported on every run but do **not** fail the build: they
are a cleanup backlog, not a regression.

**Prerequisite (registry-backed products only):** `library` and `creator` read the
question types, serializer properties, logic types and themes from the *built bundle*,
not from source, so that product must be built first or the check aborts with an
explanatory message. `analytics` is purely static (see below) and needs no build.

### Why it is not just a grep

Most SurveyJS strings are never written down as a whole key. They are assembled at
runtime from a registry:

```ts
editorLocalization.getString("qt." + this.currentType);   // toolbox.ts
editorLocalization.getString("op." + operator);           // expressionToDisplayText.ts
editorLocalization.getStringByPath(["pe", propName]);     // editorLocalization.ts
```

Searching source text for `"pe.enterNewValue"` finds nothing for ~1400 of the creator's
1673 keys, live ones included. So the linter asks each namespace's real registry
instead: `pe.*` is checked against `Serializer` property names, `qt.*` against the
registered question types, `ed.lg.*` against the logic types, and so on. Because those
registries come from the loaded bundle, a property added in `survey-core` immediately
counts as a use of its `pe.*` / `pehelp.*` / `p.*` strings.

### How a key is judged

A key is **used** when any one of three providers vouches for it:

| Provider | Vouches when |
| --- | --- |
| `literal` | the dotted path appears verbatim as a string literal in any source file |
| `resolver` | the namespace's resolver recognises the key against a live registry |
| `allowlist` | `allowlists/<product>.json` names it, with a reason |

Only a key that nobody vouches for is reported. TypeScript sources are parsed, not
regex-scanned, so a key mentioned only in a commented-out line does not count.

### allowlists/&lt;product&gt;.json

Two kinds of entry, distinguished by the reason's prefix:

- `dynamic:` — reachable, but through a lookup no static check can follow. Cite the
  call site. The creator has five, all `getString("ed." + variable)`.
- `baseline:` — dead strings inherited when the check was introduced. A cleanup
  backlog, not a permanent exemption. Delete the key from **every** locale file in the
  product, then drop the entry here.

The linter fails if an allowlist entry stops being needed — the key was deleted, or it
became reachable again — so the file cannot rot.

### Adding a product

`src/loc-lint/` knows nothing about SurveyJS apart from `products/`. Add a module to
`src/loc-lint/products/` that exports a `LocLintProduct` (locale file and export name,
source roots, one resolver per dynamically built namespace, an allowlist), then
register it in `src/loc-lint/index.ts`:

```ts
export const products: Record<string, () => LocLintProduct> = {
  library: createLibraryProduct,     // survey-core
  creator: createCreatorProduct,     // survey-creator-core
  analytics: createAnalyticsProduct, // survey-analytics
};
```

The key is the name callers type and the name of the product's `allowlists/<name>.json`.
When a product is renamed, keep the old name working by adding it to `productAliases`
in the same file (`dashboard` → `analytics`) instead of leaving a second registry entry:
an alias resolves to the product but does not make it run twice in a whole-repo check.

Three worked examples cover three shapes:

- **`products/creator.ts`** — namespaced keys (`qt.*`, `pe.*`, …), one resolver per
  namespace, each backed by a live registry (`Serializer`, `ElementFactory`, grid
  definitions). The bulk of the work.
- **`products/library.ts`** — survey-core's `englishStrings` is a *flat* table, so the
  whole key is one segment. It uses a single catch-all `"*"` resolver that recognises a
  key as used when it is the `localizationName` of some localizable string (the
  `@property({ localizable: { defaultStr: true } })` pattern, whose key is a bare
  property name the literal scan can't see). Nearly everything else is `literal`
  evidence, and the allowlist is empty.
- **`products/analytics.ts`** — survey-analytics is flat too, but its dynamic keys come
  from Plotly-backed chart/visualizer registries that won't load under Node. So its
  `"*"` resolver is *static*: `visualizer_<type>` / `chartType_<type>` / `<type>Download­Caption`
  are matched by checking the suffix is a source literal (the type is always assigned as
  a literal), while `intervalMode_<mode>` and `topNValueText<n>` are matched against
  closed enum lists copied from source. No build, no runtime.

A catch-all `"*"` resolver runs for any key whose first segment has no dedicated
resolver — the right tool for flat-key products.

If a product adds a new dynamic lookup — `getString("newns." + x)` — the check fails
until `newns` gets a resolver. That is deliberate: without one, every key in that
namespace would be silently unprovable.

## 📚 API-Doc Generation (doc-gen)

`src/doc-gen/` is the code of [surveyjs-doc-generator](https://github.com/surveyjs/surveyjs-doc-generator),
ported to TypeScript 5.7 and exposed through the `survey-utils` CLI, so a consumer needs one
build-time tool dependency instead of two. The old package still works and still ships to every
consumer; nothing has been cut over. Migration is manual, repo by repo.

```bash
survey-utils generate-doc <entry...> [options]
```

| Emitter | Produces |
| --- | --- |
| `--md` | `<ClassName>.md` per class/interface + `index.md`, in `<out>/api` |
| `--json` | The raw doc model: `classes.json` + `pmes.json` |
| `--json-definition` | `surveyjs_definition.json` from **`Serializer.generateSchema()`** — needs `--serializer` |
| `--json-definition=ast` | `surveyjs_definition.json` derived from the **AST** — a different, larger document (see below) |

They are independently selectable: the model is built once and fanned out to whichever emitters
were asked for. At least one is required — unlike the old generator, there is no implicit default.
`--serializer <path>` names the built product bundle (`./build/survey.core`) whose `Serializer`
supplies the metadata; it is optional, because survey-creator generates docs without one. All paths
resolve against the working directory, so consumers run this from their own package directory.

```jsonc
// what a consumer's package.json will eventually run — applied by hand, later
// survey-core
"doc_gen": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --md --json-definition"
// survey-creator-core (no bundle -> no schema)
"doc_gen": "survey-utils generate-doc src/entries/index.ts --md"
```

`--check` generates into memory, diffs against what is on disk and exits 1 if they differ — wire it
into CI to catch docs that were never regenerated. Two runs of the same input are byte-identical.

`generateDocumentation`, `generateMDFiles` and `setJsonObj` are still exported from the package root
with their original signatures, so a consumer can swap the dependency without rewriting its
`doc_generator/*.js` wrapper in the same step. `generateDocumentation` now also *returns* the model.

### Two producers of `surveyjs_definition.json`

The name is shared by two different documents, and they are not interchangeable:

- **runtime** (`--json-definition`, ~107 KB) — `Serializer.generateSchema()`. What the library
  actually serializes. This is the one you want, and it reproduces survey-core's
  `docs/generate_definition.js` byte for byte.
- **ast** (`--json-definition=ast`, ~128 KB) — walks the TypeScript sources instead. It is what
  survey-core's `doc_gen` script emits today. Nobody has yet established who consumes it, so it is
  ported as-is rather than dropped.

### The TypeScript 5 port

Two `ts.*` APIs changed shape between 4.2 and 5.x in ways that fail *silently* — no crash, just a
quietly wrong doc model. Both are isolated in `src/doc-gen/ts-compat.ts`:

- **`node.decorators` was removed in 5.0.** Reading it now yields `undefined`, which would drop
  every `@property()`-declared member — most of survey-core's serializable properties — from the
  model. Use `ts.canHaveDecorators` / `ts.getDecorators`.
- **`JSDocTagInfo.text` became `SymbolDisplayPart[]` in 4.3.** Assigning it straight into a
  `DocEntry` would put an array of parts where the JSON expects a string, corrupting `@title`,
  `@description`, `@deprecated`, `@see`, `@returns` and `@hidefor`.

`tests/doc-gen/members.test.ts` and `tags.test.ts` guard both.

The port was validated by diffing its output against the old generator's, run at TypeScript 4.2.4,
for survey-core and survey-creator-core. `surveyjs_definition.json` (both producers) is byte-identical.
The doc model and Markdown differ only where TypeScript 5 is *better*, in three explained ways, with
no member gained or lost:

1. DOM globals now resolve, so `any` became `HTMLElement`, `HTMLInputElement`, `File[]`, `PointerEvent`…
2. `@see` tag text no longer carries a leading space (a display-parts consequence).
3. `SurveyCreatorModel.expandCollapseManager` — an inferred type 4.2 gave up on and typed `any`.

Regenerate the baseline before changing anything in `src/doc-gen/`: a doc model with *fewer*
properties than the previous one means a `ts.*` API changed under you again.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- [SurveyJS Library](https://github.com/surveyjs/survey-library) - The main SurveyJS library
- [SurveyJS Creator](https://github.com/surveyjs/survey-creator) - Visual survey designer

## 🆘 Support

For questions and support, please visit the [SurveyJS Community Forum](https://github.com/surveyjs/survey-library/discussions).