import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction, getNewline, getNumberOfCharsForNewline } from "./utils";

const CONSECUTIVE_RUN_MSG = "Merge consecutive RUN instructions.";
const CONSECUTIVE_RUN_CODE = "R:CONSECUTIVERUN";

export default class ConsecutiveRunRepair
  implements CodeActionProvider<CodeAction>
{
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== CONSECUTIVE_RUN_CODE) continue;

      const instructionsText = document.getText(diagnostic.range);
      const secondRunKeywordPosition = instructionsText.lastIndexOf("RUN");

      const numberOfCharsForNewline = getNumberOfCharsForNewline();
      const newlineChar = getNewline();

      const replacementText = (
        instructionsText.substring(
          0,
          secondRunKeywordPosition - numberOfCharsForNewline
        ) +
        " && " +
        instructionsText.substring(secondRunKeywordPosition + 4)
      ).replace(newlineChar, "");

      const action = createAction(
        CONSECUTIVE_RUN_MSG,
        replacementText,
        document,
        diagnostic.range
      );
      actions.push(action);
    }

    return actions;
  }
}
