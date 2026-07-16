import * as path from "path";
import { buildModel } from "../../src/doc-gen";

const entry = "tests/doc-gen/fixtures/scope/product/index.entry.ts";
const productRoot = path.resolve("tests/doc-gen/fixtures/scope/product");

function classNames(rootDir?: string): string[] {
  const model = buildModel([entry], {}, rootDir);
  if (!model) throw new Error("the fixture entry file was not found");
  return model.classes.map((c: any) => c.name).sort();
}

describe("rootDir scoping", () => {
  test("without rootDir a dependency reached outside the product is documented too", () => {
    const names = classNames();
    expect(names).toContain("ProductWidget");
    expect(names).toContain("LibraryBase");
  });

  test("with rootDir only classes declared under the product root are documented", () => {
    const names = classNames(productRoot);
    expect(names).toContain("ProductWidget");
    expect(names).not.toContain("LibraryBase");
  });
});
