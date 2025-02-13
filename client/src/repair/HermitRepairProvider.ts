import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Diagnostic,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import {
  createAction,
  getInstructionText,
  getNewline,
  getRangeLength,
  isNodeProject,
  processRange,
} from "./utils";
import { getDistroUsed } from "./utils";

const HERMIT_DEPS_MSG_1 =
  "Add/update command to install detected dependencies.";
const HERMIT_DEPS_MSG_2 =
  "Remove command that installs unnecessary dependencies.";
const HERMIT_DEPS_CODE = "R:HERMITDEPS";

const HERMIT_PORTS_MSG = "Add/update command to expose detected ports.";
const HERMIT_PORTS_CODE = "R:HERMITPORTS";

const HERMIT_LANG_DEPS_MSG =
  "Add command to install the required dependencies from the language's package manager.";
const HERMIT_LANG_DEPS_CODE = "R:HERMITLANGDEPS";

export default class HermitRepairProvider
  implements CodeActionProvider<CodeAction>
{
  hermitDockerfileContent: string;

  setHermitDockerfileContent(content: string) {
    this.hermitDockerfileContent = content;
  }

  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (!this.hermitDockerfileContent) continue;

      switch (diagnostic.code) {
        case HERMIT_DEPS_CODE:
          actions.push(
            getDependenciesAction(
              this.hermitDockerfileContent,
              diagnostic,
              document
            )
          );
          break;
        case HERMIT_PORTS_CODE:
          actions.push(
            getPortsAction(this.hermitDockerfileContent, diagnostic, document)
          );
          break;
        case HERMIT_LANG_DEPS_CODE:
          actions.push(
            getLangDepsAction(
              this.hermitDockerfileContent,
              diagnostic,
              document
            )
          );
          break;
        default:
          continue;
      }
    }

    return actions;
  }
}

function getLangDepsAction(
  fileContent: string,
  diagnostic: Diagnostic,
  document: TextDocument
): CodeAction {
  const isNode = isNodeProject(document);

  const newlineChar = getNewline();
  let replacementText = newlineChar;

  if (isNode) {
    replacementText +=
      getInstructionText(fileContent, "RUN", "npm") + newlineChar;
  } else {
    replacementText +=
      getInstructionText(fileContent, "RUN", "pip3") +
      newlineChar +
      getInstructionText(fileContent, "RUN", "pip ") +
      newlineChar +
      getInstructionText(fileContent, "ENV", "PYTHONPATH") +
      newlineChar;
  }

  const range = processRange(document, diagnostic.range);

  return createAction(HERMIT_LANG_DEPS_MSG, replacementText, document, range);
}

function getPortsAction(
  fileContent: string,
  diagnostic: Diagnostic,
  document: TextDocument
): CodeAction {
  const newlineChar = getNewline();

  const lines = fileContent.split(newlineChar);

  let replacementText = newlineChar;

  lines.forEach((line) => {
    if (!line.startsWith("EXPOSE")) return;

    replacementText += line + newlineChar;
  });

  let range: Range;
  const diagnosticRangeLength = getRangeLength(document, diagnostic.range);

  if (diagnosticRangeLength > 3) range = diagnostic.range;
  else range = processRange(document, diagnostic.range);

  const action = createAction(
    HERMIT_PORTS_MSG,
    replacementText,
    document,
    range
  );

  return action;
}

function getDependenciesAction(
  fileContent: string,
  diagnostic: Diagnostic,
  document: TextDocument
): CodeAction {
  const distro = getDistroUsed(fileContent);
  const packageManagerKeyword = distro === "alpine" ? "apk" : "apt-get";

  const contentToBeCopied = getInstructionText(
    fileContent,
    "RUN",
    packageManagerKeyword
  );

  const newlineChar = getNewline();

  let range: Range;
  const diagnosticRangeLength = getRangeLength(document, diagnostic.range);

  if (diagnosticRangeLength > 3) range = diagnostic.range;
  else range = processRange(document, diagnostic.range);

  let replacementText: string, actionTitle: string;

  if (contentToBeCopied === "") {
    actionTitle = HERMIT_DEPS_MSG_2;
    replacementText = "";
  } else {
    let processedContent = contentToBeCopied
      .slice("RUN apt-get update && ".length)
      .replace(/[\n\\]/g, "")
      .replace("\t", "")
      .trim();

    let initialText = diagnosticRangeLength > 3 ? "" : "RUN apt-get update && "

    actionTitle = HERMIT_DEPS_MSG_1;
    replacementText = initialText + processedContent;
    if (initialText !== "") replacementText += newlineChar;
  }

  const action = createAction(actionTitle, replacementText, document, range);

  return action;
}
