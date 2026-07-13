# Survey Utils

Build-time tooling for the SurveyJS repos, behind one bin: **`survey-utils`**.

Three commands, each solving a problem that used to be a per-repo script:

| Command | What it does |
| --- | --- |
| `translate <product>` | Sends every not-yet-translated string in a product's locale files to the Azure Translator API and writes the result back, keeping the files' comments and structure. |
| `check-strings [product]` | Reports localization strings that no product source reaches any more, and exits `1` so CI fails when a newly added string is never used. |
| `generate-doc <entry...>` | Generates the API docs, the survey JSON Schema and the LLM authoring guide from a product's TypeScript sources and built bundle. |

```bash
survey-utils help      # the full option list
```

Products it knows: **`library`** (survey-core), **`creator`** (survey-creator-core),
**`creator-presets`** (the creator's UI presets), **`analytics`** (survey-analytics, also
accepted as `dashboard`). Each is described in full under
[Using it from a product's package.json](#-using-it-from-a-products-packagejson).

## 📁 Structure

```
survey-utils/
├── src/
│   ├── cli.ts                  # The `survey-utils` bin: translate, check-strings, generate-doc
│   ├── index.ts                # Package exports (see "The package exports" below)
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
│   └── doc-gen/                # Doc-generator specs + fixtures
├── allowlists/                 # Known-dynamic and known-dead strings, one file per product
├── run_*.cmd                   # Windows shortcuts for the checkout-local runs
├── dist/                       # Built output (generated; `bin` points at dist/cli.js)
├── tsconfig.json
├── jest.config.js
└── package.json
```

`translate` and `check-strings` expect the SurveyJS repos to sit **side by side** — the folder
that holds `survey-utils` also holds `survey-library`, `survey-creator` and `survey-analytics`.
That is how they find a product without being told where it is. **`--path <dir>` overrides that
lookup** on both commands, so a checkout anywhere on disk can be used: for `check-strings` it is
the product's repo root, for `translate` the localization folder itself. `generate-doc` takes
every path from the caller already, so it has no `--path`.

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
node ./dist/cli.js generate-doc ./entries/chunks/model.ts --md
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

Two commands behave differently once installed, and it matters:

- **`generate-doc`** takes every path from the caller, so it works from an installed dependency
  as-is. This is the command products will actually put in their `package.json`.
- **`translate`** looks the product's localization folder up next to `survey-utils` unless
  `--path` says otherwise. An installed dependency has no such siblings, so a `package.json`
  entry **must pass `--path`**.
- **`check-strings`** locates the product as a sibling of `survey-utils` unless `--path` names
  the repo root. From a product's own `package.json` that root is the working directory's repo —
  `survey-utils check-strings library --path ../..` from `packages/survey-core`.

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
    "doc_gen": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --md --json-definition",

    // The LLM authoring guide, alongside the schema. Both come from the built bundle.
    "llm_guide": "survey-utils generate-doc ./entries/chunks/model.ts --serializer ./build/survey.core --llm-guide --json-definition --out ./docs",

    // CI: regenerate in memory, diff against disk, exit 1 when someone changed survey-core
    // and did not regenerate. Output is deterministic, so two runs are byte-identical.
    "doc_gen:check": "npm run doc_gen -- --check",

    // Localization. --path is required: the folder cannot be found from node_modules.
    // No key here: it comes from TRANSLATION_API_KEY (environment, or a .env in THIS package).
    // See "Setting up the translation key" above.
    "translate": "survey-utils translate --path ./src/localization"
  }
}
```

`check-strings library` (survey-core's flat `englishStrings` table) runs from the checkout:
`node ./dist/cli.js check-strings library`, or `run_check_unused_strings_library.cmd`.

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
    "doc_gen": "survey-utils generate-doc src/entries/index.ts --md",
    "doc_gen:check": "npm run doc_gen -- --check",

    "translate": "survey-utils translate --path ./src/localization"
  }
}
```

### `creator-presets` — the creator's UI presets

A second localization folder in the same package, translated on its own. It has no docs and no
string check — only `translate`.

```jsonc
// survey-creator/packages/survey-creator-core/package.json
{
  "scripts": {
    "translate:presets": "survey-utils translate --path ./src/ui-preset-editor/localization"
  }
}
```

From the checkout it is a named product: `node ./dist/cli.js translate creator-presets`.

### `analytics` — survey-analytics (the Dashboard)

Localization only. Its string check is the one that needs **no build**: the chart types live
behind Plotly, which will not import under Node, so its resolver is static (see
[products/analytics.ts](src/loc-lint/products/analytics.ts)). `analytics` also answers to
**`dashboard`**, the name it was registered under first — both spellings select the same product,
and an alias never makes it run twice in a whole-repo check.

```jsonc
// survey-analytics/package.json
{
  "scripts": {
    "translate": "survey-utils translate --path ./src/analytics-localization"
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

`--path` is the **root of the product's repo** — the folder that holds its `package.json`, e.g.
`survey-library`, not `survey-library/packages/survey-core`. Everything the check reads (the
locale file, the source roots, the built bundle) is found under it; only `allowlists/<product>.json`
stays in survey-utils. One `--path` is one repo, so name the product it belongs to: a bare
`check-strings --path <dir>` over all three products is rejected. The `run_check_unused_strings_*.cmd`
files forward their arguments, so `run_check_unused_strings_library.cmd --path <dir>` works too.

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
survey-utils generate-doc <entry...> [options]
```

| Emitter | Produces |
| --- | --- |
| `--md` | `<ClassName>.md` per class/interface + `index.md`, in `<out>/api` |
| `--json` | The raw doc model: `classes.json` + `pmes.json` |
| `--json-definition` | `surveyjs_definition.json` from **`Serializer.generateSchema()`** — needs `--serializer` |
| `--json-definition=ast` | `surveyjs_definition.json` derived from the **AST** — a different, larger document (see below) |
| `--llm-guide` | `llm-guide.md`, the authoring guide an LLM is given as context — needs `--serializer`. Also emits `llms.txt` |

They are independently selectable: the model is built once and fanned out to whichever emitters
were asked for. At least one is required — unlike the old generator, there is no implicit default.
`--serializer <path>` names the built product bundle (`./build/survey.core`) whose `Serializer`
supplies the metadata; it is optional, because survey-creator generates docs without one.
`--out <dir>` defaults to `./docs`, `--check` diffs against disk instead of writing.

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
[llm-guide.ts](src/doc-gen/llm-guide.ts). Every JSON snippet is built through the library's own
API, serialized with `toJSON()`, then validated, loaded with `new SurveyModel(json)` and
re-serialized — a snippet that fails is never emitted.

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
