// A real import(): tsc (module: commonjs) would turn a literal one into require(), and
// inject-markdown is ESM-only with no require export. Kept in a module of its own so the tests,
// which run under ts-jest in CommonJS and cannot load the library, can mock this one function.
const importEsm = new Function("specifier", "return import(specifier)") as
  (specifier: string) => Promise<any>;

export async function loadInjectMarkdown(): Promise<typeof import("inject-markdown")> {
  return importEsm("inject-markdown");
}
