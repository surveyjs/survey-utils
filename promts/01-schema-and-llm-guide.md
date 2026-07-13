# Prompt: Survey JSON schema + LLM authoring guide

> Depends on `02-absorb-doc-generator.md`. That prompt moves surveyjs-doc-generator into survey-utils
> and introduces the `survey-utils generate-doc` CLI. This one adds `--llm-guide` to it. Do that one
> first — otherwise you will write a third copy of a TypeScript AST walk that already exists twice.

## Goal

Two artifacts, both emitted by `survey-utils generate-doc`, both derived from **survey-core only**:

1. **The JSON Schema** (`--json-definition`) — `Serializer.generateSchema()`. Its job is **checking**:
   validate JSON that an LLM, a developer, or the Creator produced, and say exactly what is wrong.
2. **The LLM authoring guide** (`--llm-guide`) — a markdown file fed to an LLM as context so that,
   given a prompt like *"a 3-page NPS survey with a follow-up when the score is below 7"*, the model
   emits SurveyJS JSON that loads and behaves correctly.

Schema constrains and verifies; the guide teaches. Generate with the guide, validate with the schema —
that loop is the whole product, and nothing owns it today.

## Do not rebuild what already exists

Most of the naive version of this feature is already written. Read `src/doc-gen/` before writing anything.

**The schema generator exists.** `survey-core/docs/generate_definition.js` already calls
`Serializer.generateSchema()` and writes a 110 KB `surveyjs_definition.json`. Prompt 02 absorbs it into
`--json-definition` — and note the conflict documented there: doc-generator has a *second*, AST-based
`surveyjs_definition.json` producer with different output. Use the runtime one. Do not write a third.

**The AST + JSDoc + Serializer join exists.** `visitor.ts` / `ast-utils.ts` / `inheritance.ts` /
`serializer.ts` already walk survey-core's TypeScript and produce `DocEntry[]` — and `DocEntry` already
carries the serializer facts this guide needs:

```ts
jsonName, jsonClassName, isSerialized, isLocalizable, defaultValue, serializedChoices,
documentation, metaTitle, metaDescription, isDeprecated, deprecationInfo, see,
allTypes /* full inheritance chain */, pmeType /* property | method | event */,
isHidden, isProtected, type, baseType
```

That is the metadata↔JSDoc join, already done. The guide is a **third emitter over that model**, a sibling
of `md-generator.ts` — not a new pipeline. Prompt 02 extracts `buildModel()` so the emitters share one pass.

**The helpers exist, in `md-generator.ts`.** Reuse, do not reimplement:

| Need | Existing |
| --- | --- |
| JSDoc summary | `firstSentence()` + `stripMarkdownLinks()` |
| API URL pattern (the `apiUrl()` this prompt used to ask for) | `sourceUrl(product, className, baseUrl)` |
| Which members to document | `isVisibleMember()` — not hidden, not protected, has a description |
| Product name | `detectProduct(fileNames, cwd)` |

Lift them out of `md-generator.ts` into a shared module rather than importing an emitter from an emitter.

What the guide emitter genuinely adds on top of `DocEntry[]`: the question-type list
(`ElementFactory.Instance.getAllTypes()`), expression operators and functions, triggers/validators, the
inheritance-dedup rule, generated+validated examples, and the size budget.

## The one hard rule: survey-core is the only source of truth

Every fact in both artifacts is extracted at generation time. **No hand-maintained tables** of question
types, properties, descriptions, operators, or examples — those rot the moment survey-core changes, and a
stale guide teaches an LLM to write JSON that no longer loads.

Facts come from the doc model (AST + JSDoc) joined with the runtime bundle:

| What | Source |
| --- | --- |
| Schema | `Serializer.generateSchema(className?)` |
| Question types | `ElementFactory.Instance.getAllTypes()` |
| Class tree / properties | `Serializer.findClass()`, `getChildrenClasses(name, true)`, `getProperties(name)` |
| Per-property facts | `JsonObjectProperty`: `type`, `schemaType()`, `className`, `isRequired`, `isLocalizable`, `isSerializable`, `isUnique`, `defaultValue`, `hasChoices` + `getChoices(null)`, `isVisible("")`, `alternativeName` |
| Property/class descriptions | JSDoc on the backing class member, via the doc model |
| Triggers | `getChildrenClasses("trigger", true)` |
| Validators | `getChildrenClasses("surveyvalidator", true)` |
| Expression functions | `FunctionFactory.Instance.getAll()` |
| Expression operators | keys of `OperandMaker.binaryFunctions` / `unaryFunctions` |
| Demo links | the `[View Demo](https://surveyjs.io/...)` URLs **already inside survey-core's JSDoc** — 236 of them, 116 unique |

**Examples are generated, not written.** Every JSON snippet is built in code
(`ElementFactory` / `Serializer.createClass` / `new SurveyModel(...)`) and emitted with `toJSON()`, then
validated against the schema. A snippet cannot drift from the library, and one that fails validation
fails the run.

The **only** hand-written text permitted is a ~10-line preamble of output rules for the model (emit one
JSON object; no Markdown fences; no comments; no trailing commas; omit default-valued properties). Keep
it in a single clearly-marked constant so a reviewer can confirm at a glance that nothing else is fixed.

## Size budget — the constraint that shapes everything

Measured against the current bundle: **22 question types, 25 classes, 1400 serializable properties** if
each class is documented with its inherited properties — but only **353 own (non-inherited) properties,
311 of them designer-visible**. At ~30–40 tokens per property line (name, JSON type, enum, default,
one-sentence summary), the deduped set lands at roughly **14–18k tokens (~55–65 KB)**. The naive 1400
would be ~200 KB, and full multi-paragraph JSDoc with demo links and `@see` tails is 4–6× that again.

So the rules are forced, not chosen:

- **Dedup by inheritance.** Document a property in the section for the class that *declares* it. Skip it
  in a subclass when `Serializer.findProperty(parentClassName, prop.name)` also resolves. This single
  rule is what makes the guide fit.
- **First sentence of the JSDoc only.** Strip `[View Demo]`/`[Read more]` links, `(linkStyle)` markers,
  `@see` tails. Capture `@deprecated` as a flag — a deprecated property is documented as "do not emit",
  or dropped.
- **Drop noise:** `isSerializable === false` (never appears in JSON), `isVisible("") === false`
  (designer-internal), `alternativeName` aliases like `hasOther`/`hasNone` (legacy parse-only — mention
  once as "never emit", do not document as properties).
- Target **≤ 60 KB**, fail above `--max-bytes` (default 80 KB). Log bytes and approximate token count
  every run.

**Ordering matters more than you would think.** `JsonObjectProperty.category` — the field that would let
you sort "data/logic" above "appearance" — is declared in `jsonobject.ts` but **survey-core never sets
it**; categories live in survey-creator's property grid. Under the survey-core-only rule you cannot use
it. The in-code proxies you do have: `isRequired`, structural properties (those with `className` /
`baseClassName`), `condition`/`expression`-typed properties, `hasChoices`, and JSDoc presence (an
undocumented property is usually internal). Sort with those so the authoring-relevant properties come
first, and degrade gracefully. Note in the README that a better signal exists in survey-creator and is
deliberately not used.

## Guide contents

1. **Provenance + output rules.** Generated from survey-core `<version>`; do not hand-edit; the
   regeneration command. Then the fixed preamble.
2. **Document shape.** survey → `pages[]` → `elements[]`; a flat root `elements[]` is legal. One
   generated, validated minimal survey.
3. **Identity rules.** `name` required and unique per survey, is the key in result data and in
   expressions; `title` is display text, falls back to `name`. Derive "required"/"unique" from
   `isRequired` / `isUnique` rather than asserting them.
4. **Shared properties, documented once** — `question`, `surveyelement`, `page`, `panel` bases.
5. **Question type catalogue.** One entry per `ElementFactory.Instance.getAllTypes()` type, plus `panel`:
   exact `type` string, class JSDoc summary, required properties, and **only its own** properties (per
   the dedup rule). Per property: name, JSON type, allowed values when `hasChoices`, default,
   `(localizable)` marker, one-sentence summary. Close with a generated minimal example.
6. **Choices** — the biggest source of malformed JSON. String shorthand vs. object form, and when the
   object form is mandatory (value ≠ text, per-item `visibleIf`/`enableIf`).
7. **Localizable strings.** `isLocalizable` properties accept a plain string or
   `{ "default": "...", "de": "..." }` (the schema's `locstring`). Prefer the bare string unless the
   prompt asks for several locales.
8. **Expressions.** The expression-valued properties from the metadata; operators enumerated from
   `OperandMaker`; functions from `FunctionFactory.Instance.getAll()`. State the syntax rules explicitly,
   since they are what models break most: question names in braces, string literals quoted, and the
   expression as a whole **not** wrapped in `{}` — `{q1} > 5 and {q2} notempty`. Cover `{panel.q}` /
   `{row.q}` inside dynamic panels and matrices.
9. **Triggers** and 10. **Validators** — from the serializer, each with a generated example.
11. **Composite structures.** `panel`, `paneldynamic` (`templateElements`), `matrixdropdown` /
    `matrixdynamic` (`columns` + `cellType`, `rows`), `matrix`. Nesting is the non-obvious part; one
    generated worked example each.
12. **Hard rules / anti-patterns.** Every claim must point at generated content, not restate knowledge:
    only the `type` strings in §5 exist (so no `"radio"`, `"dropdownlist"`, `"multiselect"`); names unique;
    expressions may only reference names that exist in the document; omit default-valued properties; no
    fences; no comments.
13. **End-to-end examples.** Three surveys of increasing complexity — a simple form; a multi-page survey
    with `visibleIf` branching and a trigger; a matrix + dynamic panel + validators survey. Built in code,
    serialized with `toJSON()`, schema-validated, then reloaded with `new SurveyModel(json)` to prove they
    round-trip.

## Links

Budgeted, not sprinkled.

- **Class-level API links: yes.** ~40 links is noise-level cost, and each one covers the long tail the
  dedup rules deliberately cut.
- **Member-level API links: not in the single-file guide.** ~400 links is 6–10k tokens — a 30–40% size
  increase — and pays off only for a consumer that can actually fetch. Emit them in the `--split` per-type
  files, where the budget is per-file and the reader is a retrieval-capable agent. Gate with
  `--with-member-links`.
- **Demo links: free, and already in the code.** survey-core's JSDoc carries 236 `[View Demo]` URLs (116
  unique). Strip them from the prose, but *capture* them and emit per-type demo links. This needs no
  dependency on the docs md files landing.
- **Never hand-write a URL.** `sourceUrl(product, className, baseUrl)` in `md-generator.ts` already builds
  every API link from a pattern; member links are `sourceUrl(...) + ".md#" + memberName`, matching the
  anchors the md emitter already produces. Add a CI link-check that samples them. A table of URLs is
  exactly the hand-maintained artifact this design exists to avoid.
- **llms.txt.** `surveyjs.io/llms.txt` currently lists HTML pages only — nothing machine-consumable. The
  highest-value addition for JSON generation is the **schema URL itself** alongside the guide: a model
  that can fetch the schema can self-check its own output. Emit an llms.txt section for both artifacts as
  a third output, so the guide's links resolve rather than merely aspire.

## Robustness

- `getChoices(null)` can return a function or throw for dynamic choices. Wrap in try/catch; retry against
  a live instance (`Serializer.createClass(name)`); if it still fails, emit the property without an enum
  and record a warning. **One bad property must never abort the run** — collect `warnings[]`, print at the
  end.
- Count properties that have no JSDoc and print the total. It measures how much of survey-core's
  documentation coverage the guide is missing, and it should trend down.
- Deterministic output: stable key order, 2-space indent, LF, trailing newline, **no timestamps** (a
  timestamp makes every run a diff). Two runs must be byte-identical — `--check` depends on it.

## Tests (jest, `tests/doc-gen/`)

- Type list is non-empty and contains known anchors (`text`, `checkbox`, `radiogroup`, `dropdown`,
  `matrixdynamic`, `paneldynamic`).
- Non-serializable properties excluded; a property inherited from `question` is not repeated in a concrete
  type's section.
- JSDoc extraction resolves a known case end to end: `text.placeholder` → *"A placeholder for the input
  field."* with the demo link stripped and captured separately. Also assert the unhandled case: a property
  with no JSDoc still renders, metadata-only.
- Schema has `$schema`, `definitions.locstring`, no dangling `$ref`.
- **The test that matters:** every JSON snippet in the generated guide is parsed, validated against the
  generated schema, loaded with `new SurveyModel(json)`, re-serialized and compared — proving the guide
  teaches JSON that actually works.
- Determinism: two consecutive runs are byte-identical.

## Deliverables

1. `--llm-guide` on `survey-utils generate-doc`, implemented as an emitter over the existing doc model.
2. Committed generated artifacts + the llms.txt section.
3. The tests above, passing.
4. README: what the two artifacts are, how to regenerate, that survey-core must be built first (bundle for
   metadata, `src/` for JSDoc), how to wire `--check` into CI, and why property ordering is weaker than it
   could be (the `category` note above).

## Constraints

- TypeScript strict, survey-utils' existing `tsconfig.json`. No new runtime deps beyond a JSON Schema
  validator for example-validation (`ajv` as a devDependency is fine — it runs in the generator and tests).
- Do not modify survey-core. If `generateSchema()` has a real bug that blocks this, report it rather than
  patching around it.
- No network access at generation time.
- Comments state constraints, not narration — same bar as `loc-lint/products/library.ts`.
