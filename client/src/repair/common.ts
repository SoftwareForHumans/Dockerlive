import { CodeAction, CodeActionKind, Uri, WorkspaceEdit, Range } from 'vscode';

export function createAction(
    actionTitle: string,
    replacementText: string,
    uri: Uri,
    processedRange: Range
  ): CodeAction {
    const action = new CodeAction(actionTitle, CodeActionKind.QuickFix);

    action.edit = new WorkspaceEdit();
    action.edit.replace(uri, processedRange, replacementText);
    action.kind = CodeActionKind.QuickFix

    return action;
  }