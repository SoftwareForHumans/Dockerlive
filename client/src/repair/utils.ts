import {
  CodeAction,
  CodeActionKind,
  Uri,
  WorkspaceEdit,
  Range,
  TextDocument,
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
  uri: Uri,
  processedRange: Range
): CodeAction {
  const action = new CodeAction(actionTitle, CodeActionKind.QuickFix);

  action.edit = new WorkspaceEdit();
  action.edit.replace(uri, processedRange, replacementText);
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
