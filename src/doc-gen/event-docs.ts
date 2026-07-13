import { GenerationContext } from "./context";
import { DocEntry } from "./types";
import {
  EventDescriptReplacedText,
  SurveyModelSenderDescription,
  CreatorModelSenderDescription
} from "./constants";

export function updateEventsDocumentation(ctx: GenerationContext): void {
  for (let i = 0; i < ctx.outputPMEs.length; i++) {
    const ser = ctx.outputPMEs[i];
    if (!ser.eventSenderName || !ser.eventOptionsName || ser.eventOptionsName === "__type") continue;
    if (!ser.documentation) ser.documentation = "";
    if (ser.documentation.indexOf("- `sender`:") > -1) continue;
    const lines: string[] = [];
    lines.push("");
    lines.push("Parameters:");
    lines.push("");
    updateEventDocumentationSender(ser, lines);
    updateEventDocumentationOptions(ctx, ser, lines);
    const replacedTextIndex = ser.documentation.indexOf(EventDescriptReplacedText);
    if (replacedTextIndex > -1) {
      ser.documentation = ser.documentation.replace(EventDescriptReplacedText, lines.join("\n"));
    } else {
      lines.unshift("");
      ser.documentation += lines.join("\n");
    }
  }
}
export function updateHiddenForEntriesDoc(ctx: GenerationContext): void {
  const addedEntries: DocEntry[] = [];
  for (let i = 0; i < ctx.outputPMEs.length; i++) {
    const ser = ctx.outputPMEs[i];
    if (Array.isArray(ser.hideForClasses)) {
      ser.hideForClasses.forEach((className: string) => {
        hideEntryForClass(ctx, ser, className, addedEntries);
      });
    }
    if (ser.isHidden === true && !!ser.className) {
      ctx.outputClasses.forEach((cls: DocEntry) => {
        if (cls.name !== ser.className && Array.isArray(cls.allTypes)
          && cls.allTypes.indexOf(<string>ser.className) > -1) {
          hideEntryForClass(ctx, ser, <string>cls.name, addedEntries);
        }
      });
    }
  }
  addedEntries.forEach((entry: DocEntry) => {
    ctx.outputPMEs.push(entry);
  });
}
function hideEntryForClass(ctx: GenerationContext, ser: DocEntry, className: string, addedEntries: DocEntry[]): void {
  const classEntry = ctx.classesHash[className];
  if (!classEntry) return;
  if (!Array.isArray(classEntry.members)) {
    classEntry.members = [];
  }
  let entry = classEntry.members.find((item: DocEntry) => item.name === ser.name);
  if (!entry) {
    entry = JSON.parse(JSON.stringify(ser));
    classEntry.members.push(<DocEntry>entry);
    addedEntries.push(<DocEntry>entry);
  }
  (<DocEntry>entry).className = className;
  (<DocEntry>entry).isHidden = true;
  (<DocEntry>entry).documentation = "";
}
function updateEventDocumentationSender(ser: DocEntry, lines: Array<string>): void {
  if (!ser.eventSenderName) return;
  let desc = "";
  if (ser.eventSenderName === "SurveyModel") {
    desc = SurveyModelSenderDescription;
  }
  if (ser.eventSenderName.indexOf("Creator") > -1) {
    desc = CreatorModelSenderDescription;
  }
  lines.push(" - `sender`: `" + ser.eventSenderName + "`" + (!!desc ? "  " : ""));
  if (!!desc) {
    lines.push(desc);
  }
}
function updateEventDocumentationOptions(ctx: GenerationContext, ser: DocEntry, lines: Array<string>): void {
  if (!ser.eventOptionsName) return;
  const members: { [name: string]: DocEntry } = {};
  fillEventMembers(ctx, ser.eventOptionsName, members);
  for (const key in members) {
    const m = members[key];
    const doc = m.documentation;
    if (m.isHidden === true || isHiddenEntryByDoc(doc)) continue;
    lines.push("- `options." + m.name + "`: `" + m.type + "`" + (!!doc ? "  " : ""));
    if (!!doc) {
      lines.push(doc);
    }
  }
}
function isHiddenEntryByDoc(doc: string | undefined): boolean {
  if (!doc) return true;
  doc = doc.toLocaleLowerCase();
  return doc.startsWith("obsolete") || doc.startsWith("for internal use");
}
function fillEventMembers(ctx: GenerationContext, interfaceName: string, members: { [name: string]: DocEntry }): void {
  const classEntry: DocEntry = ctx.classesHash[interfaceName];
  if (!classEntry) return;
  if (Array.isArray(classEntry.implements)) {
    for (let i = 0; i < classEntry.implements.length; i++) {
      fillEventMembers(ctx, classEntry.implements[i], members);
    }
  }
  if (!Array.isArray(classEntry.members)) return;
  for (let i = 0; i < classEntry.members.length; i++) {
    const m = classEntry.members[i];
    members[<string>m.name] = m;
  }
}
