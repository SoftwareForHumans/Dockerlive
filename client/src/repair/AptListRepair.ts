import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  CodeActionProvider,
  Command,
  Position,
  ProviderResult,
  Range,
  Selection,
  TextDocument,
  Uri,
  WorkspaceEdit,
} from "vscode";
import * as vscode from "vscode";
import { createAction } from "./common";
import * as os from "os";

export default class AptListRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "R:APTLIST") continue;

      const instructionText = document.getText(diagnostic.range);
      const replacementText =
        instructionText + " && rm -rf /var/lib/apt/lists/*";

      const action = createAction(
        "Add command to remove APT lists after installing packages.",
        replacementText,
        document.uri,
        diagnostic.range
      );

      actions.push(action);
    }

    return actions;
  }
}
