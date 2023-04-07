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
  isNodeProject,
} from "./utils";

const HERMIT_DEPS_MSG = "Add/update command to install detected dependencies.";
const HERMIT_DEPS_CODE = "R:HERMITDEPS";

const HERMIT_PORTS_MSG = "Add/update command to expose detected ports.";
const HERMIT_PORTS_CODE = "R:HERMITPORTS";

const HERMIT_LANG_DEPS_MSG =
  "Add command to install the required dependencies.";
const HERMIT_LANG_DEPS_CODE = "R:HERMITLANGDEPS";

export default class HermitRepair implements CodeActionProvider<CodeAction> {
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
    replacementText =
      getInstructionText(fileContent, "RUN", "npm") + newlineChar;
  } else {
    replacementText =
      getInstructionText(fileContent, "RUN", "pip3") +
      newlineChar +
      getInstructionText(fileContent, "RUN", "pip") +
      newlineChar;
  }

  return createAction(
    HERMIT_LANG_DEPS_MSG,
    replacementText,
    document,
    diagnostic.range
  );
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

  const action = createAction(
    HERMIT_PORTS_MSG,
    replacementText,
    document,
    diagnostic.range
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

  const replacementText = newlineChar + contentToBeCopied + newlineChar;

  const action = createAction(
    HERMIT_DEPS_MSG,
    replacementText,
    document,
    diagnostic.range
  );

  return action;
}

function getDistroUsed(fileContent: string): string {
  if (fileContent.includes("alpine") || fileContent.includes("apk"))
    return "alpine";

  return "debian";
}
