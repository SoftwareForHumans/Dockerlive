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
} from "./utils";

const SINGLE_COPY_MSG = "Add a second COPY instruction.";
const SINGLE_COPY_CODE = "R:SINGLECOPY";

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
      if (diagnostic.code !== SINGLE_COPY_CODE) continue;

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

      if (!copyComponents || copyComponents.length < 3) continue;

      const secondArg = copyComponents[2];

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
        " " +
        secondArg +
        (secondArg.endsWith("/") ? "" : "/") +
        newlineChar;
      const secondCopy = newlineChar + "COPY . ." + newlineChar;
      const replacementText = firstCopy + textToBeMaintained + secondCopy;

      const rangeToBeReplaced = new Range(
        document.positionAt(originalCopyIndex),
        document.positionAt(indexBeforeLastInstruction)
      );

      const action = createAction(
        SINGLE_COPY_MSG,
        replacementText,
        document.uri,
        rangeToBeReplaced
      );

      actions.push(action);
    }

    return actions;
  }
}
