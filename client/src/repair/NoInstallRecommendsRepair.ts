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
  WorkspaceEdit,
} from "vscode";

export default class NoInstallRecommendsRepair
  implements CodeActionProvider<CodeAction>
{
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
   
    if (context.diagnostics[0].code !== "R:NOINSTALLRECOMMENDS") return [];

    const processedRange = this.processRange(document, range);
    if (!processedRange) return [];

    const action = new CodeAction("Add --no-install-recommends option to apt-get install command", CodeActionKind.QuickFix)
    action.edit = new WorkspaceEdit();
    action.edit.replace(document.uri, processedRange, "apt-get install --no-install-recommends");
    return [action];
  }

  processRange(document: TextDocument, range: Range) : Range | undefined {
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
