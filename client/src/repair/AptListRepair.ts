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

const APT_LIST_MSG =
  "Add command to remove APT lists after installing packages.";
const APT_LIST_CODE = "R:APTLIST";

export default class AptListRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== APT_LIST_CODE) continue;

      const newlineChar = getNewline();

      const instructionText = document.getText(diagnostic.range);
      const replacementText =
        instructionText +
        " \\" +
        newlineChar +
        "\t&& rm -rf /var/lib/apt/lists/*";

      const action = createAction(
        APT_LIST_MSG,
        replacementText,
        document,
        diagnostic.range
      );

      actions.push(action);
    }

    return actions;
  }
}
