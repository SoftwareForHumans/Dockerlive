import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction, getNewline } from "./common";

export default class WorkDirRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "R:NOROOTDIR") continue;

      const newlineChar = getNewline();

      const replacementText = newlineChar + "WORKDIR /path/to/workdir" + newlineChar;

      const firstCharacterOfLinePosition = diagnostic.range.start;

      const range = new Range(
        firstCharacterOfLinePosition,
        firstCharacterOfLinePosition
      );

      const action = createAction(
        "Use WORKDIR to change the working directory.",
        replacementText,
        document.uri,
        range
      );

      actions.push(action);
    }

    return actions;
  }
}
