import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction } from "./utils";

const NO_INSTALL_RECOMMENDS_MSG =
  "Add --no-install-recommends option to the apt-get install command.";
const NO_INSTALL_RECOMMENDS_CODE = "R:NOINSTALLRECOMMENDS";

const CONFIRM_INSTALL_MSG = "Add -y option to the apt-get install command.";
const CONFIRM_INSTALL_CODE = "R:CONFIRMINSTALL";

const UPDATE_BEFORE_INSTALL_MSG =
  "Add the apt-get update command before apt-get install.";
const UPDATE_BEFORE_INSTALL_CODE = "R:UPDATEBEFOREINSTALL";

const NO_ADD_MSG = "Replace the ADD instruction with the COPY instruction.";
const NO_ADD_CODE = "R:NOADD";

const NO_MAINTAINER_MSG = "Remove the MAINTAINER instruction.";
const NO_MAINTAINER_CODE = "R:NOMAINTAINER";

const NO_CD_MSG = "Replace the cd command with the WORKDIR instruction.";
const NO_CD_CODE = "R:NOCD";

const F_CURL_MSG = "Add the -f option to the curl command.";
const F_CURL_CODE = "R:FCURL";

const NO_CACHE_MSG = "Add the --no-cache option to apk add command.";
const NO_CACHE_CODE = "R:NOCACHE";

export default class SimpleRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const code = diagnostic.code;
      if (typeof code !== "string") continue;

      let actionTitle: string, replacementText: string;

      switch (diagnostic.code) {
        case NO_INSTALL_RECOMMENDS_CODE:
          actionTitle = NO_INSTALL_RECOMMENDS_MSG;
          replacementText = "apt-get install --no-install-recommends";
          break;
        case CONFIRM_INSTALL_CODE:
          actionTitle = CONFIRM_INSTALL_MSG;
          replacementText = "apt-get install -y";
          break;
        case UPDATE_BEFORE_INSTALL_CODE:
          actionTitle = UPDATE_BEFORE_INSTALL_MSG;
          replacementText = "apt-get update && apt-get install";
          break;
        case NO_ADD_CODE:
          actionTitle = NO_ADD_MSG;
          replacementText = "COPY";
          break;
        case NO_MAINTAINER_CODE:
          actionTitle = NO_MAINTAINER_MSG;
          replacementText = "";
          break;
        case NO_CD_CODE:
          actionTitle = NO_CD_MSG;
          replacementText = "WORKDIR";
          break;
        case F_CURL_CODE:
          actionTitle = F_CURL_MSG;
          replacementText = "curl -f";
          break;
        case NO_CACHE_CODE:
          actionTitle = NO_CACHE_MSG;
          replacementText = "apk add --no-cache";
          break;
        default:
          continue;
      }
      actions.push(
        createAction(
          actionTitle,
          replacementText,
          document.uri,
          diagnostic.range
        )
      );
    }
    return actions;
  }
}
