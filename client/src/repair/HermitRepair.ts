import { existsSync, readFileSync } from "fs";
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

export default class HermitRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {

      if (diagnostic.code !== "R:HERMITDEPS") continue;

	  const lastIndexOfSlash = document.fileName.lastIndexOf("/");

	  const path = document.fileName.substring(0, lastIndexOfSlash);

      const hermitDockerfilePath = path + "/Dockerfile.hermit";

      const hermitDockerfileExists = existsSync(hermitDockerfilePath);

      if (!hermitDockerfileExists) continue;

      const hermitDockerfileContent =
        readFileSync(hermitDockerfilePath).toString();

      const distro = getDistroUsed(hermitDockerfileContent);
      const packageManagerKeyword = distro === "alpine" ? "apk" : "apt-get";

      const keywordIndex = hermitDockerfileContent.indexOf(
        packageManagerKeyword
      );

      const contentUntilKeyword = hermitDockerfileContent.substring(
        0,
        keywordIndex
      );

      const runIndex = contentUntilKeyword.lastIndexOf("RUN");

      const runAfterIndex = hermitDockerfileContent.indexOf(
        "RUN",
        runIndex + 1
      );

      const contentToBeCopied = hermitDockerfileContent.substring(
        runIndex,
        runAfterIndex
      );

      const firstCharacterOfLinePosition = diagnostic.range.start;

      const range = new Range(
        firstCharacterOfLinePosition,
        firstCharacterOfLinePosition
      );

      const newlineChar = getNewline();

      const replacementText = newlineChar + contentToBeCopied + newlineChar;

      const action = createAction(
        "Add command to install dependencies detected by Hermit.",
        replacementText,
        document.uri,
        range
      );

      actions.push(action);
    }

    return actions;
  }
}

function getDistroUsed(fileContent: string): string {
  if (fileContent.includes("alpine") || fileContent.includes("apk"))
    return "alpine";

  return "debian";
}
