import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Position,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import {
  createAction,
  getNewline,
  getNumberOfCharsForNewline,
  isNodeProject,
} from "./common";

export default class UserRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "R:NOROOTUSER") continue;

      const replacementText = getUserText(document) + getCopyText(document);

      const documentText = document.getText();
      const documentHasTwoCopys = hasTwoCopys(documentText);
      const actionTitle = "Add instruction to change user.";

      if (!documentHasTwoCopys) {
        actions.push(
          createAction(
            actionTitle,
            replacementText,
            document.uri,
            diagnostic.range
          )
        );
      } else {
        const lastCopyOccurrence = documentText.lastIndexOf("COPY");
        const newlineChar = getNewline();
        const newlineCharLength = getNumberOfCharsForNewline();
        const lastCopyNewline = documentText.indexOf(
          newlineChar,
          lastCopyOccurrence
        );

        const startPosition = document.positionAt(lastCopyOccurrence);
        const endPosition = document.positionAt(
          lastCopyNewline + newlineCharLength
        );
        const range = new Range(startPosition, endPosition);

        actions.push(
          createAction(actionTitle, replacementText, document.uri, range)
        );
      }
    }

    return actions;
  }
}

function hasTwoCopys(documentText: string): boolean {
  const firstCopyOccurrence = documentText.indexOf("COPY");
  const lastCopyOccurrence = documentText.lastIndexOf("COPY");

  return firstCopyOccurrence !== lastCopyOccurrence;
}

function getUserText(document: TextDocument): string {
  const isNode = isNodeProject(document);
  const user = isNode ? "node" : "python";
  const newlineChar = getNewline();

  let replacementText = newlineChar;
  if (!isNode) replacementText += "RUN useradd python" + newlineChar;
  replacementText += "USER " + user + newlineChar;

  return replacementText;
}

function getCopyText(document: TextDocument): string {
  const documentText = document.getText();
  const lastCopyOccurrence = documentText.lastIndexOf("COPY");

  const documentHasTwoCopys = hasTwoCopys(documentText);

  if (!documentHasTwoCopys) return "";

  const newlineChar = getNewline();
  const lastCopyNewline = documentText.indexOf(newlineChar, lastCopyOccurrence);

  const originalCopyText = documentText.substring(
    lastCopyOccurrence,
    lastCopyNewline
  );
  const copyArgs = originalCopyText.substring("COPY ".length - 1);

  const isNode = isNodeProject(document);
  const userText = isNode ? "node" : "python";
  const chownText = `--chown=${userText}:${userText}`;

  return newlineChar + "COPY " + chownText + copyArgs + newlineChar;
}
