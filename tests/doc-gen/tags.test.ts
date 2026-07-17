import { runDocGenerator, DocsResult } from "./helper";

describe("jsdoc tags", () => {
  let docs: DocsResult;
  beforeAll(() => {
    docs = runDocGenerator("tags");
  });

  /**
   * TypeScript 4.3 changed JSDocTagInfo.text from a string to SymbolDisplayPart[];
   * every assertion below would hold an array of parts if the port had missed it.
   */
  test("@title and @description set class meta info", () => {
    const cls = docs.findClass("ElementBase");
    expect(cls.metaTitle).toBe("Base Element");
    expect(cls.metaDescription).toBe("The base element meta description.");
  });

  test("@hidden marks the member as hidden", () => {
    expect(docs.findPME("ElementBase", "internalId").isHidden).toBe(true);
  });

  test("@hidden member is propagated to descendant classes as a hidden entry", () => {
    const entry = docs.findPME("TextElement", "internalId");
    expect(entry).toBeDefined();
    expect(entry.isHidden).toBe(true);
    expect(entry.documentation).toBe("");
    expect(docs.findMember("TextElement", "internalId")).toBeDefined();
  });

  test("@hidefor fills hideForClasses and adds a hidden entry to the listed class", () => {
    expect(docs.findPME("ElementBase", "width").hideForClasses).toEqual(["TextElement"]);
    const hidden = docs.findPME("TextElement", "width");
    expect(hidden).toBeDefined();
    expect(hidden.isHidden).toBe(true);
  });

  test("@deprecated sets isDeprecated and prefixes the info with Obsolete", () => {
    const prop = docs.findPME("ElementBase", "widthValue");
    expect(prop.isDeprecated).toBe(true);
    expect(prop.deprecationInfo).toBe("Obsolete. Use the width property instead.");
  });

  test("@since sets the since field on a class", () => {
    expect(docs.findClass("ElementBase").since).toBe("1.9.0");
  });

  test("@since sets the since field on a member", () => {
    expect(docs.findPME("ElementBase", "isVisible").since).toBe("1.9.100");
  });

  test("@see tags are collected", () => {
    // TypeScript includes the next jsdoc line's "*" in the tag text when @see is
    // not the last line of the comment -- still true on 5.8, which is why
    // md-generator keeps stripping asterisks.
    expect(docs.findPME("ElementBase", "name").see).toEqual(["width *", "widthValue"]);
  });

  test("a tag without text leaves the field absent, not empty", () => {
    // @hidden carries no text: under TS 5 the naive port would store "" here.
    const prop = docs.findPME("ElementBase", "internalId");
    expect(prop.metaTitle).toBeUndefined();
    expect(prop.deprecationInfo).toBeUndefined();
  });
});
