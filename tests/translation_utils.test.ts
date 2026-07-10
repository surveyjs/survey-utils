import { ICommentInfo, IStringToTranslate, LocalizationUtils } from "../src/localization-utils";
import { test, expect } from '@jest/globals';

test("Check page adorner css on drag over", (): any => {
    const utils = new LocalizationUtils();
    const str1 = `export var loc = {
    // top comment
  "name": "test",
  "description": "A test localization file" // right comment
};`;
   expect(utils.readJsonComments(str1)).toEqual([
       { key: "name", comment: "top comment", position: "top" },
       { key: "description", comment: "right comment", position: "right" }
   ]);
   const str2 = `export var loc = {
  "name": "test",
  "a": {
    // nested comment
    "b": "c", // right comment
    "d": "e"
  }
 };`;
 expect(utils.readJsonComments(str2)).toEqual([
      { key: "a.b", comment: "nested comment", position: "top" },
      { key: "a.b", comment: "right comment", position: "right" }
   ]);
    const str3 = `export var loc = {
  // top comment
  c: "d",
    a: {
    // top comment
    // right comment
    }
  };`;
  expect(utils.readJsonComments(str3)).toEqual([
      { key: "c", comment: "top comment", position: "top" }]);

});
test("generate json vs comments", (): any => {
  const json1 = {
    a: "a",
    "true": "b",
    "false": "c"
  };
  expect(new LocalizationUtils().generateJsonText(json1, [])).toBe(`{
  a: "a",
  "true": "b",
  "false": "c"
}`);
const json2 = {
  a: "a",
  b: "b",
  c: "c"
};
const comments: any = [
  { key: "a", comment: "comment a", position: "top" },
  { key: "b", comment: "comment b", position: "right" }
];
expect(new LocalizationUtils().generateJsonText(json2, comments)).toBe(`{
  // comment a
  a: "a",
  b: "b", // comment b
  c: "c"
}`);
});
test("get strings needed for translation", (): any => {
  const englishJSON = {
    a: "aa",
    b: "bb",
    license: "license information",
    license2: "license information2",
    c: {
      d: "dd",
      e: "ee",
      f: {
        g: "gg",
        h: "hh",
        i: "ii"
      },
      k: "hh",
      m: "mm",
      twoLines: "two lines\nsecond line"
    }
  };
  const translationText = `
export var loc = {
  "a": "a1",
  "c": {
    // [Auto-translated] "dd"
    "d": "d1",
    // [Auto-translated] "eee"
    "e": "e1",
    "f": {
      // "gg"
      "g": "g1",
      //  "ii"
      "i": "i1"
    },
    // [Auto-translated] "mm"
    m: "mm1",
    // "two lines\\nsecond line"
    twoLines: "some text\\nsecond line"
  }
};`;
  const utils = new LocalizationUtils();
  const stringsToTranslate = utils.getStringsToTranslate(translationText, englishJSON);
  expect(stringsToTranslate.length).toBe(3);
  expect(stringsToTranslate[0].text).toBe("bb");
  expect(stringsToTranslate[0].keys).toEqual(["b"]);
  expect(stringsToTranslate[1].text).toBe("ee");
  expect(stringsToTranslate[1].keys).toEqual(["c.e"]);
  expect(stringsToTranslate[2].text).toBe("hh");
  expect(stringsToTranslate[2].keys).toEqual(["c.f.h", "c.k"]);
});
test("generate new json after translation", (): any => {
  const englishJSON = {
    a: "aa",
    b: "bb",
    c: {
      d: "dd",
      e: "ee",
      f: {
        g: "gg",
        h: "hh",
        i: "ii"
      },
      k: "hh",
      m: "mm"
    }
  };
  const translationText = `
export var loc = {
  "a": "a1",
  "c": {
    "f": {
      // "gg"
      "g": "g1",
      // "ii"
      "i": "i1"
    },
    // [Auto-translated] "eee"
    "e": "e1",
    // [Auto-translated] "dd"
    "d": "d1",
    // [Auto-translated] "mm"
    m: "mm1"
  }
};`;
  const utils = new LocalizationUtils();
  const stringsToTranslate: Array<IStringToTranslate> = [  { text: "bb", keys: ["b"], translation: "bb-2" },
  { text: "ee", keys: ["c.e"], translation: "ee-2" },
  { text: "hh", keys: ["c.f.h", "c.k"], translation: "hh-2" }
];
  const englishComments: Array<ICommentInfo> = [
    { key: "a", comment: "english: aa", position: "top" },
    { key: "a", comment: "english: aa-a", position: "right" },
    { key: "b", comment: "english: bb", position: "top" },
    { key: "b", comment: "english: bb-b", position: "right" },
    { key: "c.f.i", comment: "english: ii", position: "right" },
    { key: "c.e", comment: "eee", position: "top" }
  ];
  const res = utils.getJsonWithTranslation(translationText, englishJSON, stringsToTranslate, englishComments);
  expect(res).toEqual(`{
  // english: aa
  a: "a1", // english: aa-a
  // [Auto-translated] "bb"
  b: "bb-2", // english: bb-b
  c: {
    // [Auto-translated] "dd"
    d: "d1",
    // [Auto-translated] "ee"
    e: "ee-2",
    f: {
      // "gg"
      g: "g1",
      // [Auto-translated] "hh"
      h: "hh-2",
      // "ii"
      i: "i1" // english: ii
    },
    // [Auto-translated] "hh"
    k: "hh-2",
    // [Auto-translated] "mm"
    m: "mm1"
  }
}`);
});
test("Run the full translation process", (): any => {
  const englishJSON = {
    a: "aa",
    b: "bb",
    dd: "ddd",
    c: {
      d: "dd",
      e: "ee",
      f: {
        g: "gg",
        h: "hh",
        i: "ii"
      },
      k: "hh",
      m: "mm"
    }
  };
  const translationText = `
export var loc = {
  "a": "a1",
  "dd": "ddd-ee",
  "c": {
    "f": {
      // "gg"
      "g": "g1",
      // "ii"
      "i": "i1"
    },
    // [Auto-translated] "eee"
    "e": "e1",
    // [Auto-translated] "dd"
    "d": "d1",
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const englishComments: Array<ICommentInfo> = [
    { key: "a", comment: "english: aa", position: "top" },
    { key: "a", comment: "english: aa-a", position: "right" },
    { key: "b", comment: "english: bb", position: "top" },
    { key: "b", comment: "english: bb-b", position: "right" },
    { key: "c.f.i", comment: "english: ii", position: "right" },
    { key: "c.e", comment: "eee", position: "top" }
  ];
  const utils = new LocalizationUtils();
  utils.translateStrings = (locale: string, stringsToTranslate: IStringToTranslate[], onComplete: () => void) => {
    stringsToTranslate.forEach(item => {
      item.translation = item.text + "-"+ locale;
    });
    onComplete();
  };
  let res = "";
  utils.translateText(translationText, englishJSON, (newText: string) => {
    res = newText;
  }, "test.ts", englishComments);

  expect(res).toEqual(`
export var loc = {
  // english: aa
  a: "a1", // english: aa-a
  // [Auto-translated] "bb"
  b: "bb-de", // english: bb-b
  // "ddd"
  dd: "ddd-ee",
  c: {
    // [Auto-translated] "dd"
    d: "d1",
    // [Auto-translated] "ee"
    e: "ee-de",
    f: {
      // "gg"
      g: "g1",
      // [Auto-translated] "hh"
      h: "hh-de",
      // "ii"
      i: "i1" // english: ii
    },
    // [Auto-translated] "hh"
    k: "hh-de",
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`);
});
test("Create new nested object", (): any => {
  const englishJSON = {
    c: {
      f: {
        g: "gg",
      },
      m: "mm"
    }
  };
  const translationText = `
export var loc = {
  "c": {
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const englishComments: Array<ICommentInfo> = [];
  const utils = new LocalizationUtils();
  utils.translateStrings = (locale: string, stringsToTranslate: IStringToTranslate[], onComplete: () => void) => {
    stringsToTranslate.forEach(item => {
      item.translation = item.text + "-"+ locale;
    });
    onComplete();
  };
  let res = "";
  utils.translateText(translationText, englishJSON, (newText: string) => {
    res = newText;
  }, "test.ts", englishComments);

  expect(res).toEqual(`
export var loc = {
  c: {
    f: {
      // [Auto-translated] "gg"
      g: "gg-de"
    },
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`);
});
test("Remove a string in english", (): any => {
  const englishJSON = {
    c: {
      f: {
        g: "gg"
      },
      m: "mm"
    }
  };
  const translationText = `
export var loc = {
  c: {
    f: {
      // [Auto-translated] "gg"
      g: "gg-de",
      // [Auto-translated] "hh"
      h: "hh-de"
    },
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const utils = new LocalizationUtils();
  const res = utils.updateTranslatedText(translationText, englishJSON);

  expect(res).toEqual(`
export var loc = {
  c: {
    f: {
      // [Auto-translated] "gg"
      g: "gg-de"
    },
    // [Auto-translated] "mm"
    m: "mm1"
  }
};
setupLocale({ localeCode: "de", strings: loc });
`);
});
test("Translate key with English value and no auto-generated comment", (): any => {
  const englishJSON = {
    a: "aa",
    fileSizeUnits: "Bytes, KB, MB, GB, TB",
    b: "bb"
  };
  // Case 1: Key exists in translation with English value and no comment
  const translationText1 = `
export var loc = {
  a: "a1",
  fileSizeUnits: "Bytes, KB, MB, GB, TB",
  b: "b1"
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const utils = new LocalizationUtils();
  const strings1 = utils.getStringsToTranslate(translationText1, englishJSON);
  expect(strings1.length).toBe(1);
  expect(strings1[0].text).toBe("Bytes, KB, MB, GB, TB");
  expect(strings1[0].keys).toEqual(["fileSizeUnits"]);

  // Case 2: Key exists with English value and English reference comment (from previous tool run)
  const translationText2 = `
export var loc = {
  a: "a1",
  // "Bytes, KB, MB, GB, TB"
  fileSizeUnits: "Bytes, KB, MB, GB, TB",
  b: "b1"
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const strings2 = utils.getStringsToTranslate(translationText2, englishJSON);
  expect(strings2.length).toBe(1);
  expect(strings2[0].text).toBe("Bytes, KB, MB, GB, TB");

  // Case 3: Key exists with English value and auto-generated comment => should be skipped (up-to-date)
  const translationText3 = `
export var loc = {
  a: "a1",
  // [Auto-translated] "Bytes, KB, MB, GB, TB"
  fileSizeUnits: "Bytes, KB, MB, GB, TB",
  b: "b1"
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const strings3 = utils.getStringsToTranslate(translationText3, englishJSON);
  expect(strings3.length).toBe(0);

  // Case 4: Key exists with a different (translated) value and no comment => should be skipped
  const translationText4 = `
export var loc = {
  a: "a1",
  fileSizeUnits: "Oktette, KB, MB, GB, TB",
  b: "b1"
};
setupLocale({ localeCode: "de", strings: loc });
`;
  const strings4 = utils.getStringsToTranslate(translationText4, englishJSON);
  expect(strings4.length).toBe(0);
});
