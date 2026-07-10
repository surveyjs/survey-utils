import { join } from "path";
import { translateFile, translateFiles, updateEnglishFile } from "./index";

const path = join(__dirname, "../../survey-library/packages/survey-core/src/localization");

translateFiles(path);
//Uncomment to test german file only
//translateFile(join(path, "german.ts"));
//updateEnglishFile(join(path, "english.ts"));