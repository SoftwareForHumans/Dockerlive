import { Diagnostic, Range, TextDocument } from "vscode";
import {
  getNewline,
  getNumberOfCharsForNewline,
  isNodeProject,
  processRange,
} from "./utils";
import ActionInfo from './ActionInfo';

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

  const copyText = `${newlineChar}COPY ${chownText}${copyArgs}${newlineChar}`;

  return copyText;
}

export default function getUserActionInfo(
  document: TextDocument,
  diagnostic: Diagnostic
): ActionInfo {
  const replacementText = getUserText(document) + getCopyText(document);

  const documentText = document.getText();
  const documentHasTwoCopys = hasTwoCopys(documentText);

  if (!documentHasTwoCopys) {
    const range = processRange(document, diagnostic.range);

    return { replacementText, range };
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

    return { replacementText, range };
  }
}
