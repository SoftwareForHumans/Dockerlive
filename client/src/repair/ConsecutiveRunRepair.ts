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
import * as vscode from 'vscode';
import { createAction } from "./common";
import * as os from 'os';

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
      if (diagnostic.code !== "R:CONSECUTIVERUN") continue;

      const instructionsText = document.getText(diagnostic.range);
      const secondRunKeywordPosition = instructionsText.lastIndexOf("RUN");

	  const numberOfCharsForNewline = this.getNumberOfCharsForNewline();

      const replacementText =
        instructionsText.substring(0, secondRunKeywordPosition - 2) +
        "&& " +
        instructionsText.substring(secondRunKeywordPosition + 4);
      const action = createAction(
        "Merge consecutive RUN instructions.",
        replacementText,
        document.uri,
        diagnostic.range
      );
      actions.push(action);
    }

    return actions;
  }

  getNumberOfCharsForNewline(): number {
	const systemType = os.type();
	if (systemType.includes("Windows")) return 2;
	return 1;
  }
}
