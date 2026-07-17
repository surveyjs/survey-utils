# Survey Utils

Build-time tooling for the SurveyJS repos, behind one bin: **`survey-utils`**.

Three commands, each solving a problem that used to be a per-repo script:

| Command | What it does |
| --- | --- |
| `translate <product>` | Sends every not-yet-translated string in a product's locale files to the Azure Translator API and writes the result back, keeping the files' comments and structure. |
| `check-strings [product]` | Reports localization strings that no product source reaches any more, and exits `1` so CI fails when a newly added string is never used. |
| `generate-doc [product]` | Generates the API docs, the survey JSON Schema and the LLM authoring guide from a product's TypeScript sources and built bundle. |

```bash
survey-utils help      # the full option list
```

**All three take a product and find its folders themselves.** Nothing about a repo's layout is
typed at the command line: `translate` knows where a product keeps its locale files,
`check-strings` knows its source roots, and `generate-doc` knows the entry files its docs are
built from — survey-core is documented from `entries/chunks/model.ts`, survey-pdf from
`pdf.ts` and `forms.ts` together. Name the product; `--path` says where the repo is, and only if
it is not where the command would look.

Products: **`library`** (survey-core), **`creator`** (survey-creator-core), **`analytics`**
(survey-analytics, also accepted as `dashboard`), **`pdf`** (survey-pdf, docs only), and
**`creator-presets`** (the creator's UI presets, `translate` only). Each is described in full
under [Using it from a product's package.json](#-using-it-from-a-products-packagejson).

## 📁 Structure

```
survey-utils/
├── src/
│   ├── cli.ts                  # The `survey-utils` bin: translate, check-strings, generate-doc
│   ├── index.ts                # Package exports (see "The package exports" below)
│   ├── paths.ts                # What --path means: the repo root, for every command
│   ├── doc-products.ts         # generate-doc: product -> repo, entry files, front-matter name
│   ├── translate.ts            # translate: product -> localization folder, --key, --path
│   ├── translateLibrary.ts     # Per-product entry points, kept for the run_translate_*.cmd
│   ├── translateCreator.ts     #   files; the CLI is the supported route
│   ├── translateCreatorPresets.ts
│   ├── translateAnalytics.ts
│   ├── localization-utils.ts   # Locale-file parsing: JSON + comment extraction, Azure calls
│   ├── checkUnusedStrings.ts   # check-strings: argument parsing, reporting, exit code
│   ├── loc-lint/               # The unused-string check itself
│   │   ├── inventory.ts        #   every key in a product's locale file
│   │   ├── literals.ts         #   string literals in the product's TS sources (parsed, not grepped)
│   │   ├── analyze.ts          #   judges each key: literal | resolver | allowlist
│   │   ├── products/           #   one module per product: locale file, source roots, resolvers
│   │   └── index.ts            #   the product registry + aliases (dashboard -> analytics)
│   └── doc-gen/                # The API-doc generator (absorbed from surveyjs-doc-generator)
│       ├── generator.ts        #   builds the doc model from the TS sources
│       ├── md-generator.ts     #   --md
│       ├── json-definition.ts  #   --json-definition (runtime and ast)
│       ├── llm-guide.ts        #   --llm-guide
│       ├── operators.ts        #   expression operators, read off expressions.ts' AST
│       └── ts-compat.ts        #   the two ts.* APIs that changed shape in TypeScript 5
├── tests/
│   ├── translation_utils.test.ts
│   ├── loc-lint.test.ts
│   ├── paths.test.ts           # --path and entry resolution
│   ├── doc-products.test.ts    # product -> repo + entries, and the roots it refuses
│   └── doc-gen/                # Doc-generator specs + fixtures
├── allowlists/                 # Known-dynamic and known-dead strings, one file per product
├── run_*.cmd                   # Windows shortcuts for the checkout-local runs
├── dist/                       # Built output (generated; `bin` points at dist/cli.js)
├── tsconfig.json
├── jest.config.js
└── package.json
```

## 📍 `--path <dir>` — where the repo is

`--path` means **one thing in all three commands: the root of the product's repo** — the folder
that holds its `package.json`, not a folder inside it. Each command joins its own subfolders onto
that root, so nothing else about the layout has to be typed:

```bash
survey-utils check-strings library --path ../../LibV3/survey-library
survey-utils translate     library --path ../../LibV3/survey-library
survey-utils generate-doc  library --md --path ../../LibV3/survey-library
```

| Command | What it joins onto the root |
| --- | --- |
| `check-strings` | The locale file, the source roots and the built bundle (`packages/survey-core/…`). Only `allowlists/<product>.json` stays in survey-utils. |
| `translate` | The product's localization folder (`library` → `packages/survey-core/src/localization`). |
| `generate-doc` | The product's entry files (`library` → `packages/survey-core/entries/chunks/model.ts`), and every relative path the caller passed: `--serializer`, `--out`, `--md-out`. |

Without `--path`, `translate` and `check-strings` expect the SurveyJS repos to sit **side by
side** — the folder that holds `survey-utils` also holds `survey-library`, `survey-creator`,
`survey-analytics` and `survey-pdf`. That is how they find a product without being told where it
is. `generate-doc` looks at the **working directory first** and falls back to the same sibling
lookup: a product's own `package.json` script runs inside the package it documents, and a run from
this checkout does not.

`--path` may name either the **repo root** (`../survey-library`) or the **package inside it** that
holds the entry (`../survey-library/packages/survey-core`) — both are things a caller has in hand,
and the entry files are known for each. Which one it is, is not guessed from the folder name: the
`name` in the `package.json` at that root has to be the product's. A root that holds the wrong
package is a mistake, and saying so is the whole point — a bare `src/index.ts` is survey-analytics'
entry *and* survey-utils' own file, so a check that matched on the entry path alone would cheerfully
document the wrong repo.

A `--path` is one repo, so it cannot answer for a run over several products: `check-strings
--path <dir>` with no product named is rejected, and `translate` requires the product too.

A path the caller typed and got wrong is reported as a usage mistake — **exit code 2**, no stack
trace, and the report says what it found against what it wanted:

```
library: C:\survey.js\Lib\survey-pdf is not where it is documented from.
  package.json there: survey-pdf
  expected:
    survey-library -- packages/survey-core/entries/chunks/model.ts
    survey-core -- entries/chunks/model.ts
--path must name the root of survey-library, or the package inside it that holds the entry.
```

The entries are resolved and checked **before** the `--serializer` bundle is loaded, so a run that
gets both wrong blames the entry rather than the bundle, and for every emitter — including
`--json-definition` (runtime), which never builds the doc model — so a root that is not there is
never quietly ignored.

## 🔨 Build and test

```bash
npm i
npm run build      # tsc -> dist/  (also runs on `prepare` and `prepublishOnly`)
npm test           # jest + ts-jest, over tests/
```

`survey-utils` is not on the path inside this repo, so run the built bin through `node`:

```bash
node ./dist/cli.js translate library
node ./dist/cli.js check-strings creator --list-dead
node ./dist/cli.js generate-doc library --md
```

The `npm run translate`, `npm run check:unused-strings` and `npm run generate-doc` scripts are
thin aliases for those, and take the same arguments after `--`:

```bash
npm run translate -- creator --key <key>
npm run check:unused-strings -- creator --list-dead
```

The `run_*.cmd` files at the repo root are the same runs with no arguments to remember
(`run_translate_library.cmd`, `run_check_unused_strings_creator.cmd`, …).

## 🔑 Setting up the translation key

`translate` calls the Azure Cognitive Services Translator API, which needs a **subscription
key**. Get it from the Azure portal: your Translator resource → **Keys and Endpoint** (either of
the two keys works). No other command needs one — `check-strings` and `generate-doc` never leave
the machine.

The key is read from one of three places, in this order — the first one that has it wins:

| # | Source | Use it for |
| --- | --- | --- |
| 1 | `--key <key>` on the command line | A key that lives outside this machine: a CI secret, a colleague's key, a one-off run. |
| 2 | `TRANSLATION_API_KEY` in the environment | CI, or a shell you've exported it in. |
| 3 | `TRANSLATION_API_KEY` in a `.env` file | Your own machine: set it once and forget it. |

With none of them, the command fails with an explicit error *before* it translates anything, so a
missing key never leaves the locale files half-written.

### 1. A `.env` file — the everyday setup

`.env` is the one to use locally. Copy the template and paste the key in:

```bash
cp .env.example .env
```

```ini
# .env
TRANSLATION_API_KEY=<your Azure Translator subscription key>
```

`.env` is git-ignored and **must never be committed** — a leaked key is a billable resource
someone else can spend. `.env.example` is the committed one, and holds no value.

The file is loaded from the **working directory** the command runs in, not from wherever
`survey-utils` is installed. In this repo that means `survey-utils/.env`. When a product calls
the bin from its own `package.json`, the `.env` has to sit in **that product's package** —
`survey-library/packages/survey-core/.env`, next to the `package.json` whose script runs.

### 2. The environment variable

Same variable, no file — this is what CI uses:

```bash
# bash
export TRANSLATION_API_KEY=<key>

# PowerShell
$env:TRANSLATION_API_KEY = "<key>"
```

```yaml
# a CI job: the key comes from the secret store, never from the repo
env:
  TRANSLATION_API_KEY: ${{ secrets.TRANSLATION_API_KEY }}
```

### 3. `--key` on the command line

Overrides both of the above:

```bash
node ./dist/cli.js translate library --key <key>       # in this repo
npm run translate -- --key <key>                       # through an npm script
```

**Never hard-code the key in a `scripts` entry.** It would be committed, and the `$VAR` trick
doesn't save you — a `"translate": "survey-utils translate --key $TRANSLATION_API_KEY"` script
does not expand on Windows and passes the literal text `$TRANSLATION_API_KEY` as the key. Leave
`--key` out of `package.json` entirely; let the command read the environment, and pass `--key`
after `--` on the rare run that needs a different one.

## 📦 Using it from a product's package.json

Add the dependency and call the bin from `scripts` — npm puts `node_modules/.bin` on the path,
so the bare `survey-utils` name resolves. Every path a command takes is resolved against the
**working directory**, i.e. the package the script runs in.

```jsonc
{
  "devDependencies": { "survey-utils": "^1.0.0" }
}
```

An installed dependency has no sibling checkouts, so `translate` and `check-strings` cannot find
the product by looking next to themselves: both need **`--path`**, and from a package inside a
monorepo it is the repo root above it — `--path ../..` from `packages/survey-core`. `generate-doc`
needs none: the working directory *is* the package it documents, its `package.json` names the
product, and the entry files follow from that.

Nothing has been cut over yet — no product depends on `survey-utils`, and
[surveyjs-doc-generator](https://github.com/surveyjs/surveyjs-doc-generator) still ships to every
consumer. The entries below are what each product will run; migration is manual, repo by repo.

### `library` — survey-library / packages/survey-core

The one product that uses all three commands. `survey-core` must be **built first** for the
doc commands and for `check-strings`: the question types, serializer properties, defaults and
themes are read from the built bundle, not from source, so a stale bundle documents the previous
release and a missing one aborts the check with an explanatory message.

```jsonc
// survey-library/packages/survey-core/package.json
{
  "scripts": {
    // Markdown API docs + the survey JSON Schema. Replaces doc_generator/lib_docgenerator.js.
    // No entry file, no --path, no --serializer and no --out: 'library' plus this package.json is
    // the whole address, and ./build/survey.core and ./docs follow from it. Build first: the
    // schema is generated from the bundle.
    "doc_gen": "survey-utils generate-doc library --md --json-definition",

    // The LLM authoring guide, alongside the schema. Both come from the built bundle, and both
    // are survey-core's, so neither needs the product named. --llm-guide-out puts
    // survey-json-authoring.md under ./llms while the schema stays in ./docs.
    "llm_guide": "survey-utils generate-doc --llm-guide --json-definition --llm-guide-out llms",

    // CI: regenerate in memory, diff against disk, exit 1 when someone changed survey-core
    // and did not regenerate. Output is deterministic, so two runs are byte-identical.
    "doc_gen:check": "npm run doc_gen -- --check",

    // Localization. --path is the repo root: the product cannot be found from node_modules.
    // No key here: it comes from TRANSLATION_API_KEY (environment, or a .env in THIS package).
    // See "Setting up the translation key" above.
    "translate": "survey-utils translate library --path ../..",

    // The unused-string check, over the same repo root.
    "check:unused-strings": "survey-utils check-strings library --path ../.."
  }
}
```

From this checkout the same check needs no `--path`: `node ./dist/cli.js check-strings library`,
or `run_check_unused_strings_library.cmd`.

### `creator` — survey-creator / packages/survey-creator-core

Docs only, and **without a bundle**: survey-creator has no `Serializer` of its own to generate a
schema from, so it selects `--md` alone and every serializer-derived section is skipped. No build
is needed for the docs — but `check-strings creator` does need `survey-creator-core` built,
because it reads the property grid, question types and logic types from the bundle.

```jsonc
// survey-creator/packages/survey-creator-core/package.json
{
  "scripts": {
    // No --serializer -> no --json-definition, no --llm-guide. Replaces
    // doc_generator/editor_docgenerator.js.
    "doc_gen": "survey-utils generate-doc creator --md",
    "doc_gen:check": "npm run doc_gen -- --check",

    "translate": "survey-utils translate creator --path ../..",
    "check:unused-strings": "survey-utils check-strings creator --path ../.."
  }
}
```

### `creator-presets` — the creator's UI presets

A second localization folder in the same package (`src/ui-preset-editor/localization`), translated
on its own. It has no docs and no string check — only `translate`, and it is a product of its own
precisely because the repo root cannot tell the two folders apart.

```jsonc
// survey-creator/packages/survey-creator-core/package.json
{
  "scripts": {
    "translate:presets": "survey-utils translate creator-presets --path ../.."
  }
}
```

From the checkout: `node ./dist/cli.js translate creator-presets`.

### `analytics` — survey-analytics (the Dashboard)

Localization, and docs from `src/index.ts` — no bundle, so no schema and no guide. Its string check
is the one that needs **no build**: the chart types live behind Plotly, which will not import under
Node, so its resolver is static (see [products/analytics.ts](src/loc-lint/products/analytics.ts)).
`analytics` also answers to **`dashboard`**, the name it was registered under first — both spellings
select the same product, and an alias never makes it run twice in a whole-repo check.

Its package *is* its repo root, so `--path .` is what the scripts pass.

```jsonc
// survey-analytics/package.json
{
  "scripts": {
    // Replaces doc_generator/lib_docgenerator.js src/index.ts.
    "doc:gen": "survey-utils generate-doc analytics --md",

    "translate": "survey-utils translate analytics --path .",
    "check:unused-strings": "survey-utils check-strings analytics --path ."
  }
}
```

### `pdf` — survey-pdf (the PDF Generator)

**Docs only**, and the one product documented from **two entries at once** — `src/entries/pdf.ts`
and `src/entries/forms.ts`, exactly as its own `doc_gen` script always passed them. Naming the
product keeps that pair together; it is the sort of detail a caller should not have to remember,
and the reason the entries live in a table rather than in each repo's scripts. Its package is its
repo root, and it has no localization, so it is not a `translate` or `check-strings` product.

```jsonc
// survey-pdf/package.json
{
  "scripts": {
    // Replaces doc_generator/lib_docgenerator.js src/entries/pdf.ts src/entries/forms.ts.
    "doc_gen": "survey-utils generate-doc pdf --md",
    "doc_gen:check": "npm run doc_gen -- --check"
  }
}
```

```bash
# from this repo -- no build of survey-analytics required
node ./dist/cli.js check-strings analytics
node ./dist/cli.js check-strings dashboard    # the alias, kept for old scripts
```

### The package exports

`generateDocumentation`, `generateMDFiles` and `setJsonObj` are still exported from the package
root with their original `surveyjs-doc-generator` signatures (`generateDocumentation` now also
*returns* the model), so a consumer can swap the dependency without rewriting its
`doc_generator/*.js` wrapper in the same step. The bin is the supported route; the exports exist
for that one migration step.

## 🧹 Unused-String Check (loc-lint)

```bash
survey-utils check-strings analytics              # verdict + summary
survey-utils check-strings creator --list-dead    # print the cleanup backlog
survey-utils check-strings                        # every known product

# a checkout that is not a sibling of survey-utils
survey-utils check-strings library --path ../../LibV3/survey-library
```

`--path` is the repo root, as everywhere ([above](#-path-dir--where-the-repo-is)): everything the
check reads — the locale file, the source roots, the built bundle — is found under it, and only
`allowlists/<product>.json` stays in survey-utils. The `run_*.cmd` files forward their arguments,
so `run_check_unused_strings_library.cmd --path <dir>` works too.

```
library:   0 new unused string(s), 0 known dead, 0 dynamic exemption(s).
creator:   0 new unused string(s), 0 known dead, 5 dynamic exemption(s).
analytics: 0 new unused string(s), 0 known dead, 0 dynamic exemption(s).
```

The five exemptions are `dynamic:` keys built at runtime (e.g. `getLocString("ed." + state)`).
`N known dead` means strings recorded with a `baseline:` reason that are already unused and
waiting to be deleted; `--list-dead` prints them grouped by namespace.

**Exit code 1 — the build should fail** when a *new* unused string appears, when an allowlist
entry rots, or when a dynamic namespace loses its resolver. Strings already recorded as
`baseline:` are reported on every run but do **not** fail the build: they are a cleanup backlog,
not a regression.

### Why it is not just a grep

Most SurveyJS strings are never written down as a whole key. They are assembled at runtime from
a registry:

```ts
editorLocalization.getString("qt." + this.currentType);   // toolbox.ts
editorLocalization.getString("op." + operator);           // expressionToDisplayText.ts
editorLocalization.getStringByPath(["pe", propName]);     // editorLocalization.ts
```

Searching source text for `"pe.enterNewValue"` finds nothing for ~1400 of the creator's 1673
keys, live ones included. So the linter asks each namespace's real registry instead: `pe.*` is
checked against `Serializer` property names, `qt.*` against the registered question types,
`ed.lg.*` against the logic types, and so on. Because those registries come from the loaded
bundle, a property added in `survey-core` immediately counts as a use of its `pe.*` / `pehelp.*` /
`p.*` strings.

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

- `dynamic:` — reachable, but through a lookup no static check can follow. Cite the call site.
  The creator has five, all `getString("ed." + variable)`.
- `baseline:` — dead strings inherited when the check was introduced. A cleanup backlog, not a
  permanent exemption. Delete the key from **every** locale file in the product, then drop the
  entry here.

The linter fails if an allowlist entry stops being needed — the key was deleted, or it became
reachable again — so the file cannot rot.

### Adding a product

`src/loc-lint/` knows nothing about SurveyJS apart from `products/`. Add a module to
`src/loc-lint/products/` that exports a `LocLintProduct` (locale file and export name, source
roots, one resolver per dynamically built namespace, an allowlist), then register it in
`src/loc-lint/index.ts`:

```ts
export const products: Record<string, (root?: string) => LocLintProduct> = {
  library: createLibraryProduct,     // survey-core
  creator: createCreatorProduct,     // survey-creator-core
  analytics: createAnalyticsProduct, // survey-analytics
};
```

The factory's `root` is what `--path` passed. Build every path in the product module under it —
`productRoot(repo, root)` in [paths.ts](src/loc-lint/paths.ts) resolves it, falling back to the
sibling checkout and failing with an actionable message when the folder is not there.

The key is the name callers type and the name of the product's `allowlists/<name>.json`. When a
product is renamed, keep the old name working by adding it to `productAliases` in the same file
(`dashboard` → `analytics`) instead of leaving a second registry entry.

The three existing products cover three shapes:

- **`products/creator.ts`** — namespaced keys (`qt.*`, `pe.*`, …), one resolver per namespace,
  each backed by a live registry (`Serializer`, `ElementFactory`, grid definitions). The bulk of
  the work.
- **`products/library.ts`** — survey-core's `englishStrings` is a *flat* table, so the whole key
  is one segment. It uses a single catch-all `"*"` resolver that recognises a key as used when it
  is the `localizationName` of some localizable string (the
  `@property({ localizable: { defaultStr: true } })` pattern, whose key is a bare property name
  the literal scan can't see). Nearly everything else is `literal` evidence, and the allowlist is
  empty.
- **`products/analytics.ts`** — flat too, but its dynamic keys come from Plotly-backed
  chart/visualizer registries that won't load under Node. So its `"*"` resolver is *static*:
  `visualizer_<type>` / `chartType_<type>` / `<type>DownloadCaption` are matched by checking the
  suffix is a source literal (the type is always assigned as a literal), while
  `intervalMode_<mode>` and `topNValueText<n>` are matched against closed enum lists copied from
  source. No build, no runtime.

A catch-all `"*"` resolver runs for any key whose first segment has no dedicated resolver — the
right tool for flat-key products. If a product adds a new dynamic lookup —
`getString("newns." + x)` — the check fails until `newns` gets a resolver. That is deliberate:
without one, every key in that namespace would be silently unprovable.

## 📚 Doc generation (doc-gen)

`src/doc-gen/` is the code of
[surveyjs-doc-generator](https://github.com/surveyjs/surveyjs-doc-generator), ported to
TypeScript 5.7 and exposed through the CLI, so a consumer needs one build-time tool dependency
instead of two.

```bash
survey-utils generate-doc [product] [options]
```

| Product | Documented from | Front matter | Default out |
| --- | --- | --- | --- |
| `library` | `packages/survey-core/entries/chunks/model.ts` | Form Library | `packages/survey-core/docs` |
| `creator` | `packages/survey-creator-core/src/entries/index.ts` | Survey Creator | `packages/survey-creator-core/docs` |
| `analytics` | `src/index.ts` | Dashboard | `docs` |
| `pdf` | `src/entries/pdf.ts` **and** `src/entries/forms.ts` | PDF Generator | `docs` |

The `Default out` column is relative to the repo root. A run from inside the package writes that
same folder as `./docs`, because it is already there.

The entry files are a fact of each repo's layout, not a decision the caller makes — so the product
is all that is named, and the table above (in [doc-products.ts](src/doc-products.ts)) supplies the
rest: which repo to look in, which entries to compile, and the product name written into the
Markdown front matter and the documentation URLs. Each product is also listed with the package the
entries are relative to, so the same name works from the repo root and from the package inside it.

| Emitter | Produces |
| --- | --- |
| `--md` | `<ClassName>.md` per class/interface + `index.md`, in `<out>/api` |
| `--json` | The raw doc model: `classes.json` + `pmes.json` |
| `--json-definition` | `surveyjs_definition.json` from **`Serializer.generateSchema()`** — needs survey-core **built** |
| `--json-definition=ast` | `surveyjs_definition.json` derived from the **AST** — a different, larger document (see below), from the sources alone |
| `--llm-guide` | `survey-json-authoring.md`, the authoring guide an LLM is given as context — needs survey-core **built**. Also emits `llms.txt` |

They are independently selectable: the model is built once and fanned out to whichever emitters
were asked for. At least one is required — unlike the old generator, there is no implicit default,
so a run that names none writes nothing and is a mistake, not a no-op: it exits **2** and prints
the four flags above to choose from, rather than pointing at the usage text.

**The bundle.** `--serializer <path>` names the built product bundle whose `Serializer` supplies
the metadata, and it **defaults to the product's own**: survey-core's `./build/survey.core`, found
under the root like the entries and the docs folder are. So a built product needs no `--serializer`
— it is there to name a bundle somewhere *else*. Without one the docs are AST/JSDoc only and every
serializer-derived section is skipped, which is a legitimate run (survey-creator has no `Serializer`
of its own and has always generated docs that way) — so a missing bundle only **warns**, naming the
path it looked at. `--json-definition` (runtime) and `--llm-guide` cannot work without it, and those
report the bundle they wanted and exit **2** rather than generate half a document.

`--out <dir>` defaults to the docs folder of the package the product is documented from — the
`Default out` column above — so a run from the repo root and a run from the package itself write
the same folder; `--check` diffs against disk instead of writing.

`--llm-guide-out <dir>` writes `survey-json-authoring.md` somewhere other than `--out`, resolved
against `--path` the same way — the guide belongs under `survey-core/llms` while the API docs and
the schema stay in `docs`. Only the guide file moves; the per-type `--split` files and `llms.txt`
stay in `--out`. It only applies alongside `--llm-guide`.

**Which emitters need the product.** `--md` and `--json` document one product's API, so the run has
to say which — omit it and the command exits `2` listing the four. `--json-definition` and
`--llm-guide` need **no** product: the schema is `Serializer.generateSchema()` and the guide is
built from the question types, so both are survey-core's whatever else is generated, and the
product is always `library`. Asking for either of them *for another product* is rejected rather
than quietly ignored:

```
survey-utils generate-doc creator --md --llm-guide --serializer ...
--llm-guide cannot be generated for 'creator': the schema and the guide both come from
survey-core, so they only apply to 'library'.
```

**`--entry <path>`** is the escape hatch, repeatable: it documents an entry the table does not
cover — a fork, another chunk, another package — instead of the product's own. Nothing in the
SurveyJS repos needs it; it exists so that an unusual layout is not a reason to go back to the old
generator.

### The schema and the guide

Both derive from survey-core alone. **The schema constrains and verifies; the guide teaches.**
Generate with the guide, validate with the schema.

**survey-core must be built first.** The generator reads it twice: the built bundle for the
metadata — question types, properties, defaults — and the TypeScript sources under `src/` for the
JSDoc.

The expression operators come from the sources too, and deliberately so. They are declared as
static object literals inside `expressions.ts` — values in a file, not API members — so
[operators.ts](src/doc-gen/operators.ts) reads their names off its AST rather than asking
survey-core to export the internal class that holds them. A documentation generator should not
cost the library a permanent public-API commitment. The source only supplies the candidate names;
which of them an author may actually write, and how it is spelled, is settled by
`ConditionsParser`, which survey-core already exports: a spelling it rejects never reaches the
guide, so the internal helpers drop out on their own, and `greater` is reported as `>` because
that is what the library renders it as.

Every fact in both files is extracted at generation time. There are **no hand-maintained tables**
of types, properties, descriptions, operators or examples: those rot the moment survey-core
changes, and a stale guide teaches a model to write JSON that no longer loads. The only fixed
prose is a ~10-line block of output rules, in one constant in
[llm-guide.ts](src/doc-gen/llm-guide.ts); the guide also points the model at the schema for its
own copy of survey-core (`unpkg.com/survey-core@<version>`, pinned to the generated version) so it
can self-check what it writes. Every JSON snippet is built through the library's own API,
serialized with `toJSON()`, then validated, loaded with `new SurveyModel(json)` and re-serialized
— a snippet that fails is never emitted.

### Three things worth knowing

**`generateSchema()` cannot catch an unknown question type.** It never emits a schema for
`elements`, so the per-type definitions it generates are unreachable when a survey is validated:
`{"type": "radio"}` — which is not a SurveyJS type — validates clean. The schema still checks the
survey's own properties and their types. Because of this the generator does not rely on it alone;
it also checks every snippet's `type` strings against `ElementFactory.getAllTypes()` and
round-trips the JSON through `SurveyModel`. Fixing this properly belongs in survey-core, not here.

**Property ordering is weaker than it could be.** `JsonObjectProperty.category` is the field that
would sort "data/logic" above "appearance", but survey-core never sets it — the categories live in
survey-creator's property grid, and the survey-core-only rule puts them out of reach. The guide
sorts on the proxies that *are* in the library: required first, then structural properties, then
expression-valued ones, then enums, then whatever is documented.

**The size budget.** The guide is spent from a context window, so every run logs its bytes and
approximate token count, and the run fails above `--max-bytes` (default 96 KB). The question
types, the shared bases and the survey/page shell come to ~57 KB; the triggers, validators and
nested objects an author also has to get right add ~16 KB more. `--split` emits one file per
question type instead, for a reader that retrieves rather than reads it all, and
`--with-member-links` adds member-level API links there.

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
quietly wrong doc model. Both are isolated in [ts-compat.ts](src/doc-gen/ts-compat.ts):

- **`node.decorators` was removed in 5.0.** Reading it now yields `undefined`, which would drop
  every `@property()`-declared member — most of survey-core's serializable properties — from the
  model. Use `ts.canHaveDecorators` / `ts.getDecorators`.
- **`JSDocTagInfo.text` became `SymbolDisplayPart[]` in 4.3.** Assigning it straight into a
  `DocEntry` would put an array of parts where the JSON expects a string, corrupting `@title`,
  `@description`, `@deprecated`, `@see`, `@returns` and `@hidefor`.

`tests/doc-gen/members.test.ts` and `tags.test.ts` guard both.

The port was validated by diffing its output against the old generator's, run at TypeScript 4.2.4,
for survey-core and survey-creator-core. `surveyjs_definition.json` (both producers) is
byte-identical. The doc model and Markdown differ only where TypeScript 5 is *better*, in three
explained ways, with no member gained or lost:

1. DOM globals now resolve, so `any` became `HTMLElement`, `HTMLInputElement`, `File[]`, `PointerEvent`…
2. `@see` tag text no longer carries a leading space (a display-parts consequence).
3. `SurveyCreatorModel.expandCollapseManager` — an inferred type 4.2 gave up on and typed `any`.

Regenerate the baseline before changing anything in `src/doc-gen/`: a doc model with *fewer*
properties than the previous one means a `ts.*` API changed under you again.

## 📄 License

MIT — see [LICENSE](LICENSE).

## 🔗 Related

- [SurveyJS Library](https://github.com/surveyjs/survey-library)
- [SurveyJS Creator](https://github.com/surveyjs/survey-creator)
- [SurveyJS Dashboard](https://github.com/surveyjs/survey-analytics)
