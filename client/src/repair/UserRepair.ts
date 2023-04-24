import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import {
  createAction,
  getNewline,
  getNumberOfCharsForNewline,
  isNodeProject,
  processRange,
} from "./utils";

const NO_ROOT_USER_MSG =
  "Add instruction to change user (COPY instructions will be updated accordingly).";
const NO_ROOT_USER_CODE = "R:NOROOTUSER";

export default class UserRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== NO_ROOT_USER_CODE) continue;

      const replacementText = getUserText(document) + getCopyText(document);

      const documentText = document.getText();
      const documentHasTwoCopys = hasTwoCopys(documentText);
      const actionTitle = NO_ROOT_USER_MSG;

      if (!documentHasTwoCopys) {
        const range = processRange(document, diagnostic.range);

        actions.push(
          createAction(actionTitle, replacementText, document, range)
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
          createAction(actionTitle, replacementText, document, range)
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
  const copyArgs = originalCopyText.substring("COPY ".length - 1).trim();

  const isNode = isNodeProject(document);
  const userText = isNode ? "node" : "python";
  let chownText = `--chown=${userText}:${userText} `;

  if (copyArgs.includes("--chown")) chownText = "";

  const copyText = `${newlineChar}COPY ${chownText}${copyArgs}${newlineChar}`

  return copyText;
}
