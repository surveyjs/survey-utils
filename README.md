# Survey Utils

A utility library for SurveyJS localization and translation management.

## 🚀 Quick Start

### Prerequisites

Before running any translation commands, make sure to install dependencies and build the project:

```bash
# Install dependencies
npm i

# Compile TypeScript files
npm run build
```

The translation commands call the Azure Translator API, which needs a subscription key.
Copy the template and fill in the key — `.env` is git-ignored and must never be committed:

```bash
cp .env.example .env
```

```ini
TRANSLATION_API_KEY=<your Azure Translator subscription key>
```

Find the key in the Azure portal under your Translator resource → **Keys and Endpoint**.
Commands that translate text fail with an explicit error if `TRANSLATION_API_KEY` is not set.

### Translation Commands

This tool provides two main translation commands for different SurveyJS libraries:

#### 📚 Translate Survey Core Library
```bash
./run_translate_library.cmd
```
This command translates strings for the **survey-core** library.

#### 🛠️ Translate Survey Creator Library  
```bash
./run_translate_creator.cmd
```
This command translates strings for the **survey-creator-core** library.

### 🧹 Unused-String Check

```bash
./run_check_unused_strings_creator.cmd
```

Reports localization keys that no product source reaches any more, and exits with code
`1` so CI fails when a newly added string is never used. See
[Unused-String Check (loc-lint)](#-unused-string-check-loc-lint) below.

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
import { updateCommentFiles, translateFile } from 'survey-utils';

// Update all translation files in a directory
updateCommentFiles('/path/to/localization/files');

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
│   └── localization-utils.ts # Core utilities
├── tests/
│   └── translation_utils.test.ts # Unit tests
├── .vscode/
│   ├── launch.json           # Debug configurations
│   └── tasks.json            # Build tasks
├── dist/                     # Built files (generated)
├── translateLibrary.ts       # Translation script
├── run_translate_library.cmd # Survey Core translation
├── run_translate_creator.cmd # Survey Creator translation
├── package.json              # Package configuration
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

```bash
npm run build
npm run check:unused-strings creator                # verdict + summary
npm run check:unused-strings creator -- --list-dead # print the cleanup backlog
npm run check:unused-strings                        # every known product
```

```
creator: 0 new unused string(s), 0 known dead, 5 dynamic exemption(s).
```

The five exemptions are `dynamic:` keys built at runtime (e.g. `getLocString("ed." + state)`).
If a run ever shows `N known dead`, those are strings recorded with a `baseline:` reason
that are already unused and waiting to be deleted; `--list-dead` prints them grouped by
namespace.

**Exit code 1 — the build should fail** when a *new* unused string appears, when an
allowlist entry rots, or when a dynamic namespace loses its resolver. Strings already
recorded as `baseline:` are reported on every run but do **not** fail the build: they
are a cleanup backlog, not a regression.

**Prerequisite:** the product must be built. The linter reads the question types,
serializer properties, logic types and themes from the *built bundle*
(`survey-creator-core/build/survey-creator-core.js`), not from source. Build the
product first, or the check aborts with an explanatory message.

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
  creator: createCreatorProduct,
  library: createLibraryProduct,   // survey-core
};
```

`products/creator.ts` is the worked example. `survey-core`'s `englishStrings` is a flat
table with far fewer dynamic lookups, so its config should be mostly `literal` evidence
and a short allowlist.

If a product adds a new dynamic lookup — `getString("newns." + x)` — the check fails
until `newns` gets a resolver. That is deliberate: without one, every key in that
namespace would be silently unprovable.

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