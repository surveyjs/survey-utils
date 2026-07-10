import { JSDOM } from "jsdom";

let installed = false;

/**
 * Installs a minimal DOM on `global`.
 *
 * A product config that instantiates a UI model -- `new SurveyCreatorModel()` --
 * must call this *before* requiring the product bundle. Without it the bundle
 * throws on `window.navigator` during construction.
 */
export function installDom(): void {
  if (installed) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const window = dom.window as unknown as Record<string, unknown>;
  // Plain assignment throws on Node >= 21, where `globalThis.navigator` is a
  // getter-only accessor. defineProperty overrides it either way.
  ["window", "document", "navigator", "self", "HTMLElement", "Element", "Node", "getComputedStyle"].forEach((name) => {
    const value = name === "window" || name === "self" ? dom.window : window[name];
    Object.defineProperty(global, name, { value: value, writable: true, configurable: true });
  });
  installed = true;
}
