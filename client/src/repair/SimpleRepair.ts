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

export default class SimpleRepair implements CodeActionProvider<CodeAction> {
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
            "Add --no-install-recommends option to the apt-get install command.";
          replacementText = "apt-get install --no-install-recommends";
          break;
        case "R:CONFIRMINSTALL":
          actionTitle = "Add -y option to the apt-get install command.";
          replacementText = "apt-get install -y";
          break;
        case "R:UPDATEBEFOREINSTALL":
          actionTitle =
            "Add the apt-get update command before apt-get install.";
          replacementText = "apt-get update && apt-get install";
          break;
        case "R:NOADD":
          actionTitle =
            "Replace the ADD instruction with the COPY instruction.";
          replacementText = "COPY";
          break;
        case "R:NOMAINTAINER":
          actionTitle = "Remove the MAINTAINER instruction.";
          replacementText = "";
          break;
        case "R:NOCD":
          actionTitle = "Replace the cd command with the WORKDIR instruction.";
          replacementText = "WORKDIR";
          break;
        case "R:FCURL":
          actionTitle = "Add the -f option to the curl command.";
          replacementText = "curl -f";
          break;
        case "R:NOCACHE":
          actionTitle = "Add the --no-cache option to apk add command.";
          replacementText = "apk add --no-cache";
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
