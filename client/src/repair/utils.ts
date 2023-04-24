import {
  CodeAction,
  CodeActionKind,
  Uri,
  WorkspaceEdit,
  Range,
  TextDocument,
  Position,
} from "vscode";
import * as os from "os";

export function isNodeProject(document: TextDocument): boolean {
  const documentText = document.getText();
  const fromIndex = documentText.indexOf("FROM");
  const imageIndex = fromIndex + "FROM ".length;
  const image = documentText.substring(
    imageIndex,
    imageIndex + "python".length
  );
  const isNode = image.startsWith("node");
  return isNode;
}

export function isPythonProject(document: TextDocument): boolean {
  return !isNodeProject(document);
}

export function createAction(
  actionTitle: string,
  replacementText: string,
  document: TextDocument,
  range: Range
): CodeAction {
  const action = new CodeAction(actionTitle, CodeActionKind.QuickFix);

  action.edit = new WorkspaceEdit();
  action.edit.replace(document.uri, range, replacementText);
  action.kind = CodeActionKind.QuickFix;

  return action;
}

export function getNewline(): string {
  const systemType = os.type();
  if (systemType.includes("Windows")) return "\r\n";
  return "\n";
}

export function getNumberOfCharsForNewline(): number {
  const systemType = os.type();
  if (systemType.includes("Windows")) return 2;
  return 1;
}

export function getInstructionText(
  fileContent: string,
  instructionName: string,
  keyword: string
): string {
  const keywordIndex = fileContent.indexOf(keyword);

  if (keywordIndex === -1) return "";

  const contentUntilKeyword = fileContent.substring(0, keywordIndex);

  const instructionStartIndex =
    contentUntilKeyword.lastIndexOf(instructionName);

  const offset = instructionStartIndex + instructionName.length;

  let instructionEndIndex = fileContent.slice(offset).search(/[A-Z]/);

  if (instructionEndIndex === -1) instructionEndIndex = fileContent.length;
  else instructionEndIndex += offset;

  const text = fileContent.substring(
    instructionStartIndex,
    instructionEndIndex
  );

  return cleanupText(text);
}

export function processRange(document: TextDocument, range: Range): Range {
  const textInRange = document.getText(range);

  if (textInRange.trim() !== "") {
    const line = range.start.line;
    const character = 0;
    const pos = new Position(line, character);
    return new Range(pos, pos);
  }

  return range;
}

function cleanupText(text: string): string {
  const newlineChar = getNewline();

  return text.replace(newlineChar + "#", "").trim();
}

export function getDistroUsed(fileContent: string): string {
  if (fileContent.includes("alpine") || fileContent.includes("apk"))
    return "alpine";

  return "debian";
}
