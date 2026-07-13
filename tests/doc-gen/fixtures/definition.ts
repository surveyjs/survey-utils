/**
 * The base class for all objects.
 */
export class Base {
  public getType(): string {
    return "base";
  }
}
/**
 * A survey page.
 */
export class PageModel extends Base {
  public getType(): string {
    return "page";
  }
  /**
   * The page name.
   */
  public name: string = "";
}
/**
 * A survey model. The AST JSON definition is rooted at this class.
 */
export class SurveyModel extends Base {
  public getType(): string {
    return "survey";
  }
  /**
   * The survey title.
   */
  public title: string = "";
  /**
   * The survey mode.
   */
  public mode: string = "edit";
  /**
   * The survey pages.
   */
  public pages: PageModel[] = [];
}
