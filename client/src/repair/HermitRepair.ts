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
  hermitDockerfileContent: string;
  
  setHermitDockerfileContent(content: string) {
    this.hermitDockerfileContent = content;
  }

  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (!this.hermitDockerfileContent) continue;

      switch (diagnostic.code) {
        case "R:HERMITDEPS":
          actions.push(
            getDependenciesAction(this.hermitDockerfileContent, diagnostic, document)
          );
          break;
        case "R:HERMITPORTS":
          actions.push(
            getPortsAction(this.hermitDockerfileContent, diagnostic, document)
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
    "Add command to expose detected ports.",
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
    "Add command to install detected dependencies.",
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
