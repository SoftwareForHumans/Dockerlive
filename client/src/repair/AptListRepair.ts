import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction } from "./common";

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

      const instructionText = document.getText(diagnostic.range);
      const replacementText =
        instructionText + " && rm -rf /var/lib/apt/lists/*";

      const action = createAction(
        APT_LIST_MSG,
        replacementText,
        document.uri,
        diagnostic.range
      );

      actions.push(action);
    }

    return actions;
  }
}
