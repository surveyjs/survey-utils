# Survey Utils

Build tools for SurveyJS repositories. Run them with the `survey-utils` CLI.

| Command | Purpose |
| --- | --- |
| `translate <product>` | Translate missing locale strings with Azure Translator |
| `check-strings [product]` | Find unused localization strings |
| `generate-doc [product or preset]` | Generate API docs, JSON Schema, and an LLM authoring guide |

## Setup

From this checkout:

```bash
npm install
npm run build
npm test
node ./dist/cli.js help
```

In this checkout, run the examples with `node ./dist/cli.js` instead of `survey-utils`. You can also pass arguments after `--` to the `translate`, `check:unused-strings`, and `generate-doc` npm scripts:

```bash
npm run translate -- creator                        # Translate Creator strings
npm run check:unused-strings -- creator --list-dead # Check Creator and list known dead strings
```

To use the CLI in another project's npm scripts, add `survey-utils` as a development dependency. See [npm script examples](#npm-script-examples).

### Products and Paths

| Product | Repository / package | Supported commands |
| --- | --- | --- |
| `library` | [`survey-library/packages/survey-core`](https://github.com/surveyjs/survey-library/tree/master/packages/survey-core) | `translate`, `check-strings`, `generate-doc` |
| `creator` | [`survey-creator/packages/survey-creator-core`](https://github.com/surveyjs/survey-creator/tree/master/packages/survey-creator-core) | `translate`, `check-strings`, `generate-doc` |
| `analytics` | [`survey-analytics`](https://github.com/surveyjs/survey-analytics) | `translate`, `check-strings`, `generate-doc` |
| `pdf` | [`survey-pdf`](https://github.com/surveyjs/survey-pdf) | `generate-doc` |
| `creator-presets` | Creator UI preset localization | `translate` |

**Notes:**

- `--path <dir>` sets the product repository root, relative to the working directory. Each command finds its source files there.
- Without `--path`, [`translate`](#translation) and [`check-strings`](#unused-string-checks) look for repositories beside `survey-utils`.
- [`generate-doc`](#documentation-generation) checks the working directory first, then the repository beside `survey-utils`. It accepts a repository or package root, such as `survey-library/packages/survey-core`, and checks the package name and entry files.
- For `generate-doc`, relative `--out`, `--md-out`, `--llm-guide-out`, and `--serializer` paths start at the selected product root. The default output folder is the package's `docs` folder.
- [`--llm-guide`](#documentation-generation) writes the guide to `llms` under the selected root unless `--llm-guide-out` is set.
- For [`-site` presets](#build-and-site-presets), `--out` sets the site content repository root, relative to the working directory. The default is the `surveyjs-site-data` checkout beside `survey-utils`.
- [`paths.json`](paths.json) lists the theme source, site output folders, and design-token topics. [`src/doc-products.ts`](src/doc-products.ts) lists product entry files and package layouts.

## Translation

`translate` uses Azure Translator to fill missing translations in a product's locale files. It keeps the comments and file structure.

```bash
survey-utils translate library --path ../survey-library # Translate Form Library strings
survey-utils translate creator-presets --path ../survey-creator # Translate Creator UI presets
```

### API Key

Get a subscription key from your Azure Translator resource's **Keys and Endpoint** page. `translate` looks for the key in this order:

1. `--key <key>` passed with the command
2. The `TRANSLATION_API_KEY` environment variable
3. `TRANSLATION_API_KEY` in a `.env` file in the working directory

For local setup:

```bash
cp .env.example .env # Create a local config file, then add your key
```

```ini
TRANSLATION_API_KEY=<your Azure Translator subscription key>
```

**Notes:**

- When using a product's npm script, put `.env` beside its `package.json`.
- In CI, set `TRANSLATION_API_KEY` from the secret store.
- Keep keys out of version control and npm scripts.
- If no key is found, `translate` stops before changing any files.

## Unused-String Checks

```bash
survey-utils check-strings # Check all supported products
survey-utils check-strings library --path ../survey-library # Check a specific library checkout
survey-utils check-strings creator --list-dead # Check Creator and list known dead strings
```

**Notes:**

- With `--path`, name exactly one product.
- Build `survey-core` before checking `library`, and `survey-creator-core` before checking `creator`. These checks read registries from the built bundles. Analytics needs no build.
- A string counts as used if its key appears as a TypeScript string literal, a product resolver finds it in a registry, or an [allowlist](#allowlists) lists its dynamic lookup. Source comments do not count as uses.
- The check exits with code `1` for new unused strings, allowlist entries that no longer apply, or dynamic namespaces without a resolver.
- Known unused strings are reported but do not fail the check.

### Allowlists

Each file in [allowlists](allowlists) lists exceptions for a specific product. Each reason starts with one of two prefixes:

- `dynamic:` - A runtime lookup the check cannot follow. Include where the lookup is called.
- `baseline:` - A known unused string. Delete it from every locale file, then remove the allowlist entry.

## Documentation Generation

```bash
survey-utils generate-doc library --md --json-definition # Generate library API docs and schema
survey-utils generate-doc creator --md # Generate Creator API docs from source
survey-utils generate-doc --llm-guide --json-definition # Generate the library authoring guide and schema
survey-utils generate-doc pdf --md --check # Check PDF API docs without writing files
```

Choose at least one output flag:

| Flag | Output |
| --- | --- |
| `--md` | One Markdown file per class or interface, plus `index.md`, in `<out>/api` |
| `--json` | The documentation model: `classes.json` and `pmes.json` |
| `--json-definition` | `surveyjs_definition.json` from `Serializer.generateSchema()` |
| `--json-definition=ast` | A schema built from source, with the same filename but different content from the runtime schema |
| `--llm-guide` | `survey-json-authoring.md`, plus `llms.txt` in `<out>` |

**Notes:**

- Build `survey-core` before generating the runtime schema or authoring guide. The default bundle is `build/survey.core` inside the package. Creator, analytics, and PDF API docs need no build.

### Options

| Option | Purpose |
| --- | --- |
| `--path <dir>` | Product repository or package root |
| `--out <dir>` | Output folder; defaults to the package's `docs` |
| `--md-out <dir>` | Markdown output folder; defaults to `<out>/api` |
| `--llm-guide-out <dir>` | Authoring guide folder; defaults to `llms` under the selected root |
| `--serializer <path>` | Use a different built bundle |
| `--entry <path>` | Use a different source entry; repeat for multiple entries |
| `--source-base-url <url>` | Base URL for documentation links; defaults to `https://surveyjs.io` |
| `--check` | Compare generated output with saved files without writing; exit `1` if they differ |
| `--max-bytes <n>` | Maximum guide size; defaults to 98304 bytes (96 KB) |
| `--split` | Also generate one file per question type in `<out>/llm-guide` |
| `--with-member-links` | Add member API links to split guide files |

**Notes:**

- `--llm-guide-out` moves only `survey-json-authoring.md`. Split files and `llms.txt` stay under `--out`.
- The runtime schema and guide use metadata from the selected library build.
- The generator checks guide examples against registered element types and loads them through `SurveyModel`. The runtime schema alone does not catch unknown question types.

### Build and Site Presets

Presets generate a fixed set of files for package builds or site publishing. They accept only `--path` and `--out`. All other options are ignored.

```bash
# Generate files for the survey-core package in its build folder
survey-utils generate-doc library-build --path ../survey-library --out packages/survey-core/build

# Generate library site docs and update design-token tables
survey-utils generate-doc library-site --path ../survey-library --out ../surveyjs-site-data

# Generate Creator site docs in the same content repository
survey-utils generate-doc creator-site --path ../survey-creator --out ../surveyjs-site-data
```

| Preset | Destination | Generated files |
| --- | --- | --- |
| `library-build` | `<out>` | `llms.txt` from [`static/llms.txt`](static/llms.txt), `surveyjs_definition.json`, and `llms/survey-json-authoring.md` |
| `library-site` | `<out>/DocsLibrary` | `classes.json`, `pmes.json`, `surveyjs_definition.json`, `llms/survey-json-authoring.md`, and `api-reference/` |
| `creator-site` | `<out>/DocsEditor` | `classes.json`, `pmes.json`, and `api-reference/` |
| `analytics-site` | `<out>/DocsAnalytics` | `classes.json`, `pmes.json`, and `api-reference/` |
| `pdf-site` | `<out>/DocsPdf` | `classes.json`, `pmes.json`, and `api-reference/` |
| `creator-build`, `analytics-build`, `pdf-build` | None | No output |

**Notes:**

- For `-build`, `--out` is relative to the product root and defaults to the package's `docs` folder.
- For `-site`, pass the content repository root (`surveyjs-site-data`). The preset chooses the product folder inside it.
- Build `survey-core` before running either library preset.
- `library-site` also updates the design-token topics under the content repository root.

### Design-Token Tables

`library-site` uses the library's default theme to fill tables in the topics listed in `site.tokenTopics` in [`paths.json`](paths.json). The default topic is `<out>/Docs/complete-design-token-list.md`.

Mark each table with a `<div>` whose ID filters token names:

```html
<div id="-component-action-">
</div>
```

**Notes:**

- Separate multiple filters with `|`, for example `-component-checkbox- | -component-radio-`.
- Keep the final dash to avoid matching components with similar names. Filters also match tokens that end with the component name, such as `--sjs2-radius-component-action`.
- The generator replaces each placeholder's contents and keeps the placeholder and the theme's token order. Run it again to update added, removed, and changed tokens.
- Values leave out `var()` wrappers and the `--sjs2-` prefix.
- Missing topics are reported and skipped.
- Each run reports row counts and warns about filters with no matches or component tokens missing from all tables.

## npm Script Examples

Add `survey-utils` to your package's `devDependencies` to use the CLI in npm scripts. `translate` and `check-strings` need `--path` when run this way. `generate-doc` can find the product from the working directory.

### Form Library

In `survey-library/packages/survey-core/package.json`:

```json
{
  "scripts": {
    "doc_gen": "survey-utils generate-doc library --md --json-definition",
    "llm_guide": "survey-utils generate-doc --llm-guide --json-definition",
    "doc_gen:check": "npm run doc_gen -- --check",
    "translate": "survey-utils translate library --path ../..",
    "check:unused-strings": "survey-utils check-strings library --path ../.."
  }
}
```

### Survey Creator

In `survey-creator/packages/survey-creator-core/package.json`:

```json
{
  "scripts": {
    "doc_gen": "survey-utils generate-doc creator --md",
    "doc_gen:check": "npm run doc_gen -- --check",
    "translate": "survey-utils translate creator --path ../..",
    "translate:presets": "survey-utils translate creator-presets --path ../..",
    "check:unused-strings": "survey-utils check-strings creator --path ../.."
  }
}
```

### Dashboard

In `survey-analytics/package.json`:

```json
{
  "scripts": {
    "doc:gen": "survey-utils generate-doc analytics --md",
    "translate": "survey-utils translate analytics --path .",
    "check:unused-strings": "survey-utils check-strings analytics --path ."
  }
}
```

### PDF Generator

In `survey-pdf/package.json`:

```json
{
  "scripts": {
    "doc_gen": "survey-utils generate-doc pdf --md",
    "doc_gen:check": "npm run doc_gen -- --check"
  }
}
```

## Development Reference

| Location | Contents |
| --- | --- |
| [src/cli.ts](src/cli.ts) | CLI commands and documentation presets |
| [src/doc-gen](src/doc-gen) | API docs, schema, and authoring guide generators |
| [src/loc-lint](src/loc-lint) | Unused-string analysis and product resolvers |
| [src/translate.ts](src/translate.ts) | Translation command and product paths |
| [src/token-tables](src/token-tables) | Design-token extraction and table generation |
| [tests](tests) | Test suites and fixtures |

**Notes:**

- To add a product's unused-string check, implement `LocLintProduct` in [`src/loc-lint/products/`](src/loc-lint/products/) and register it in [`src/loc-lint/index.ts`](src/loc-lint/index.ts). Set its locale file, source roots, dynamic resolvers, and allowlist. Use the supplied root for product paths.
- Use the CLI for new scripts. See [src/index.ts](src/index.ts) for all exports.

## License

[MIT](LICENSE)
