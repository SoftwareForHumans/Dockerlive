import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction, getNewline } from "./utils";

const NO_ROOT_DIR_MSG = "Use WORKDIR to change the working directory.";
const NO_ROOT_DIR_CODE = "R:NOROOTDIR";

export default class WorkDirRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== NO_ROOT_DIR_CODE) continue;

      const newlineChar = getNewline();

      const replacementText = newlineChar + "WORKDIR /app" + newlineChar;

      const firstCharacterOfLinePosition = diagnostic.range.start;

      const range = new Range(
        firstCharacterOfLinePosition,
        firstCharacterOfLinePosition
      );

      const action = createAction(
        NO_ROOT_DIR_MSG,
        replacementText,
        document,
        range
      );

      actions.push(action);
    }

    return actions;
  }
}
