import { GenerationContext } from "./context";
import { DocEntry, DocEntryType } from "./types";

/** set allParentTypes */
export function setAllParentTypes(ctx: GenerationContext, className: string): void {
  if (!className) return;
  const cur = ctx.classesHash[className];
  if (cur.allTypes && cur.allTypes.length > 0) return;
  setAllParentTypesCore(ctx, cur);
}
function setAllParentTypesCore(ctx: GenerationContext, cur: DocEntry): void {
  cur.allTypes = [];
  cur.allTypes.push(<string>cur.name);
  if (cur.entryType === DocEntryType.interfaceType && Array.isArray(cur.implements)) {
    cur.implements.forEach((item) => addBaseAllTypesIntoCur(ctx, cur, item));
  }
  if (!cur.baseType) return;
  addBaseAllTypesIntoCur(ctx, cur, cur.baseType);
}
function addBaseAllTypesIntoCur(ctx: GenerationContext, cur: DocEntry, className: string): void {
  if (!className) return;
  const baseClass = ctx.classesHash[className];
  if (!baseClass) return;
  if (!baseClass.allTypes) {
    setAllParentTypesCore(ctx, baseClass);
  }
  const allTypes = <string[]>baseClass.allTypes;
  for (let i = 0; i < allTypes.length; i++) {
    (<string[]>cur.allTypes).push(allTypes[i]);
  }
}
