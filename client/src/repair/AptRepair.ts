import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction } from './common';

export default class AptRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const code = diagnostic.code;
      if (typeof code !== "string") continue;

      let actionTitle: string, replacementText: string;

      switch (diagnostic.code) {
        case "R:NOINSTALLRECOMMENDS":
          actionTitle =
            "Add --no-install-recommends option to apt-get install command";
          replacementText = "apt-get install --no-install-recommends";
          break;
        case "R:CONFIRMINSTALL":
          actionTitle = "Add -y option to apt-get install command";
          replacementText = "apt-get install -y";
          break;
        case "R:UPDATEBEFOREINSTALL":
          actionTitle = "Add the apt-get update command before apt-get install";
          replacementText = "apt-get update && apt-get install";
          break;
        default:
          continue;
      }
      actions.push(
        createAction(
          actionTitle,
          replacementText,
          document.uri,
          diagnostic.range
        )
      );
    }
    return actions;
  }
}
