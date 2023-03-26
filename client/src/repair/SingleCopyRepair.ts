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

export default class SingleCopyRepair
  implements CodeActionProvider<CodeAction>
{
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== "R:SINGLECOPY") continue;

      const documentText = document.getText();

      const originalCopyIndex = documentText.indexOf("COPY");
      const newlineChar = getNewline();
      const newLineCharLength = getNumberOfCharsForNewline();
      const indexAfterOriginalCopy =
        documentText.indexOf(newlineChar, originalCopyIndex) +
        newLineCharLength;

      const cmdIndex = documentText.indexOf("CMD");
      const entrypointIndex = documentText.indexOf("ENTRYPOINT");
      const lastInstructionIndex = cmdIndex !== -1 ? cmdIndex : entrypointIndex;
      const indexBeforeLastInstruction =
        lastInstructionIndex - newLineCharLength;

      const rangeToBeMaintained = new Range(
        document.positionAt(indexAfterOriginalCopy),
        document.positionAt(indexBeforeLastInstruction)
      );
      const textToBeMaintained = document.getText(rangeToBeMaintained);

      const isNode = isNodeProject(document);

      const firstCopy =
        "COPY " +
        (isNode ? "package*.json" : "requirements.txt") +
        " ." +
        newlineChar;
      const secondCopy = newlineChar + "COPY . ." + newlineChar;
      const replacementText = firstCopy + textToBeMaintained + secondCopy;

      const rangeToBeReplaced = new Range(
        document.positionAt(originalCopyIndex),
        document.positionAt(indexBeforeLastInstruction)
      );

      const action = createAction(
        "Add a second COPY instruction.",
        replacementText,
        document.uri,
        rangeToBeReplaced
      );

      actions.push(action);
    }

    return actions;
  }
}
