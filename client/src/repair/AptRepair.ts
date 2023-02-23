import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  CodeActionProvider,
  Command,
  Position,
  ProviderResult,
  Range,
  Selection,
  TextDocument,
  Uri,
  WorkspaceEdit,
} from "vscode";

export default class AptRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const processedRange = this.processRange(document, range);
    if (processedRange === undefined) return [];
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const code = diagnostic.code;
      if (typeof code !== "string") continue;

      let actionTitle: string, replacementText: string;

      switch (diagnostic.code) {
        case "R:NOINSTALLRECOMMENDS":
          actionTitle =
            "Add --no-install-recommends option to apt-get install command";
          replacementText = "apt-get install --no-install-recommends";
          break;
        case "R:CONFIRMINSTALL":
          actionTitle = "Add -y option to apt-get install command";
          replacementText = "apt-get install -y";
          break;
        case "R:UPDATEBEFOREINSTALL":
          actionTitle = "Add the apt-get update command before apt-get install";
          replacementText = "apt-get update && apt-get install";
          break;
        default:
          continue;
      }
      actions.push(
        this.createAction(
          actionTitle,
          replacementText,
          document.uri,
          processedRange
        )
      );
    }

    return actions;
  }

  createAction(
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

  processRange(document: TextDocument, range: Range): Range | undefined {
    const start = range.start;
    const end = range.end;

    if (start.line !== end.line) return;

    const line = document.lineAt(start.line);
    const rangeText = line.text.substring(start.character, end.character);

    if (rangeText === "apt-get install") return range;

    const lineNumber = start.line;
    const lineText = document.lineAt(lineNumber).text;

    const firstCharNumber = lineText.indexOf("apt-get");
    const lastCharNumber = lineText.indexOf("install") + "install".length;

    const processedStart = new Position(lineNumber, firstCharNumber);
    const processedEnd = new Position(lineNumber, lastCharNumber);

    const processedRange = new Range(processedStart, processedEnd);

    return processedRange;
  }
}
