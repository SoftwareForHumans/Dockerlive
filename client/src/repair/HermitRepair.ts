import { existsSync, readFileSync } from "fs";
import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Diagnostic,
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
      const lastIndexOfSlash = document.fileName.lastIndexOf("/");
      const path = document.fileName.substring(0, lastIndexOfSlash);
      const hermitDockerfilePath = path + "/Dockerfile.hermit";
      const hermitDockerfileExists = existsSync(hermitDockerfilePath);

      if (!hermitDockerfileExists) continue;

      const hermitDockerfileContent =
        readFileSync(hermitDockerfilePath).toString();

      switch (diagnostic.code) {
        case "R:HERMITDEPS":
          actions.push(
            getDependenciesAction(hermitDockerfileContent, diagnostic, document)
          );
          break;
        case "R:HERMITPORTS":
          actions.push(
            getPortsAction(hermitDockerfileContent, diagnostic, document)
          );
          break;
        default:
          continue;
      }
    }

    return actions;
  }
}

function getPortsAction(
  fileContent: string,
  diagnostic: Diagnostic,
  document: TextDocument
): CodeAction {
  const newlineChar = getNewline();

  const lines = fileContent.split(newlineChar);

  let replacementText = newlineChar;

  lines.forEach((line) => {
    if (!line.startsWith("EXPOSE")) return;

    replacementText += line + newlineChar;
  });

  const action = createAction(
    "Add command to expose ports detected by Hermit.",
    replacementText,
    document.uri,
    diagnostic.range
  );

  return action;
}

function getDependenciesAction(
  fileContent: string,
  diagnostic: Diagnostic,
  document: TextDocument
): CodeAction {
  const distro = getDistroUsed(fileContent);
  const packageManagerKeyword = distro === "alpine" ? "apk" : "apt-get";

  const keywordIndex = fileContent.indexOf(packageManagerKeyword);

  const contentUntilKeyword = fileContent.substring(0, keywordIndex);

  const runIndex = contentUntilKeyword.lastIndexOf("RUN");

  const runAfterIndex = fileContent.indexOf("RUN", runIndex + 1);

  const contentToBeCopied = fileContent.substring(runIndex, runAfterIndex);

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

  return action;
}

function getDistroUsed(fileContent: string): string {
  if (fileContent.includes("alpine") || fileContent.includes("apk"))
    return "alpine";

  return "debian";
}
