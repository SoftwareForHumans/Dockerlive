import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction, getNewline, isNodeProject } from "./utils";
import getCopyActionInfo from "./copy";
import getUserActionInfo from "./user";

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

const APT_LIST_MSG =
  "Add command to remove APT lists after installing packages.";
const APT_LIST_CODE = "R:APTLIST";

const CONSECUTIVE_RUN_MSG = "Merge consecutive RUN instructions.";
const CONSECUTIVE_RUN_CODE = "R:CONSECUTIVERUN";

const NO_HTTP_URL_MSG = "Change the URL to use HTTPS.";
const NO_HTTP_URL_CODE = "R:NOHTTPURL";

const NO_ROOT_DIR_MSG = "Use WORKDIR to change the working directory.";
const NO_ROOT_DIR_CODE = "R:NOROOTDIR";

const NO_IMAGE_PIN_MSG = "Pin image version.";
const NO_IMAGE_PIN_CODE = "R:NOIMAGEPIN";

const NO_ROOT_USER_MSG =
  "Add instruction to change user (COPY instructions will be updated accordingly).";
const NO_ROOT_USER_CODE = "R:NOROOTUSER";

const SINGLE_COPY_MSG = "Add a second COPY instruction.";
const SINGLE_COPY_CODE = "R:SINGLECOPY";

export default class RepairProvider implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    _range: Range | Selection,
    context: CodeActionContext,
    _token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      const code = diagnostic.code;
      if (typeof code !== "string") continue;

      let action: CodeAction;

      switch (diagnostic.code) {
        case NO_INSTALL_RECOMMENDS_CODE: {
          const actionTitle = NO_INSTALL_RECOMMENDS_MSG;
          const replacementText = "apt-get install --no-install-recommends";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case CONFIRM_INSTALL_CODE: {
          const actionTitle = CONFIRM_INSTALL_MSG;
          const replacementText = "apt-get install -y";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case UPDATE_BEFORE_INSTALL_CODE: {
          const actionTitle = UPDATE_BEFORE_INSTALL_MSG;
          const replacementText = "apt-get update && apt-get install";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_ADD_CODE: {
          const actionTitle = NO_ADD_MSG;
          const replacementText = "COPY";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_MAINTAINER_CODE: {
          const actionTitle = NO_MAINTAINER_MSG;
          const replacementText = "";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_CD_CODE: {
          const actionTitle = NO_CD_MSG;
          const replacementText = "WORKDIR";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case F_CURL_CODE: {
          const actionTitle = F_CURL_MSG;
          const replacementText = "curl -f";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_CACHE_CODE: {
          const actionTitle = NO_CACHE_MSG;
          const replacementText = "apk add --no-cache";
          action = createAction(
            actionTitle,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case APT_LIST_CODE: {
          const newlineChar = getNewline();

          const instructionText = document.getText(diagnostic.range);
          const replacementText =
            instructionText +
            " \\" +
            newlineChar +
            "\t&& rm -rf /var/lib/apt/lists/*";

          action = createAction(
            APT_LIST_MSG,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case CONSECUTIVE_RUN_CODE: {
          const instructionsText = document.getText(diagnostic.range);
          const secondRunKeywordPosition = instructionsText.lastIndexOf("RUN");

          const newlineChar = getNewline();

          const replacementText =
            instructionsText
              .substring(0, secondRunKeywordPosition)
              .trimRight() +
            " \\" +
            newlineChar +
            "\t&& " +
            instructionsText.substring(secondRunKeywordPosition + 4);

          action = createAction(
            CONSECUTIVE_RUN_MSG,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_HTTP_URL_CODE: {
          const originalUrl = document.getText(diagnostic.range);

          const replacementText = originalUrl.replace("http", "https");

          action = createAction(
            NO_HTTP_URL_MSG,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_ROOT_DIR_CODE: {
          const newlineChar = getNewline();

          const replacementText = newlineChar + "WORKDIR /app" + newlineChar;

          const firstCharacterOfLinePosition = diagnostic.range.start;

          const range = new Range(
            firstCharacterOfLinePosition,
            firstCharacterOfLinePosition
          );

          action = createAction(
            NO_ROOT_DIR_MSG,
            replacementText,
            document,
            range
          );
          break;
        }
        case NO_IMAGE_PIN_CODE: {
          const isNode = isNodeProject(document);

          const image = isNode ? "node:18-slim" : "python:3.11-slim";

          const replacementText = "FROM " + image;

          action = createAction(
            NO_IMAGE_PIN_MSG,
            replacementText,
            document,
            diagnostic.range
          );
          break;
        }
        case NO_ROOT_USER_CODE: {
          const actionTitle = NO_ROOT_USER_MSG;
          const { replacementText, range } = getUserActionInfo(
            document,
            diagnostic
          );
          action = createAction(actionTitle, replacementText, document, range);
          break;
        }
        case SINGLE_COPY_CODE: {
          const actionTitle = SINGLE_COPY_MSG;
          const actionInfo = getCopyActionInfo(document);
          if (!actionInfo) continue;
          const { replacementText, range } = actionInfo;
          action = createAction(actionTitle, replacementText, document, range);
          break;
        }
        default:
          continue;
      }
      actions.push(action);
    }
    return actions;
  }
}
