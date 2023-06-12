import {
  Range,
  TextDocument,
} from "vscode";
import {
  getNewline,
  getNumberOfCharsForNewline,
  isNodeProject,
} from "./utils";
import ActionInfo from "./ActionInfo";

function getChownText(documentText: string): string {
  const userIndex = documentText.indexOf("USER");

  if (userIndex === -1) return "";

  const newlineChar = getNewline();

  const newlineAfterUserIndex = documentText.indexOf(newlineChar, userIndex);

  const userStartIndex = userIndex + "USER ".length;

  const user = documentText.substring(userStartIndex, newlineAfterUserIndex);

  const chownText = `--chown=${user}:${user} `;

  return chownText;
}

export default function getCopyActionInfo(
  document: TextDocument
): ActionInfo | null {
  const documentText = document.getText();

  const originalCopyIndex = documentText.indexOf("COPY");

  const newlineChar = getNewline();

  const firstNewlineAfterCopy = documentText.indexOf(
    newlineChar,
    originalCopyIndex
  );

  const originalCopyContent = documentText
    .substring(originalCopyIndex, firstNewlineAfterCopy)
    .replace("  ", " ");

  const copyComponents = originalCopyContent.split(" ");

  if (!copyComponents || copyComponents.length < 3) return null;

  const secondArg = copyComponents[2];

  const newLineCharLength = getNumberOfCharsForNewline();
  const indexAfterOriginalCopy =
    documentText.indexOf(newlineChar, originalCopyIndex) + newLineCharLength;

  const cmdIndex = documentText.indexOf("CMD");
  const entrypointIndex = documentText.indexOf("ENTRYPOINT");
  const lastInstructionIndex = cmdIndex !== -1 ? cmdIndex : entrypointIndex;
  const indexBeforeLastInstruction = lastInstructionIndex - newLineCharLength;

  const rangeToBeMaintained = new Range(
    document.positionAt(indexAfterOriginalCopy),
    document.positionAt(indexBeforeLastInstruction)
  );
  const textToBeMaintained = document.getText(rangeToBeMaintained);

  const isNode = isNodeProject(document);

  const chownText = getChownText(documentText);

  const firstCopy =
    "COPY " +
    (isNode ? "package*.json" : "requirements.txt") +
    " " +
    secondArg +
    (secondArg.endsWith("/") ? "" : "/") +
    newlineChar;
  const secondCopy = `${newlineChar}COPY ${chownText}. .${newlineChar}`;
  const replacementText = firstCopy + textToBeMaintained + secondCopy;

  const rangeToBeReplaced = new Range(
    document.positionAt(originalCopyIndex),
    document.positionAt(indexBeforeLastInstruction)
  );

  return { replacementText, range: rangeToBeReplaced };
}
