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

const NO_HTTP_URL_MSG = "Change the URL to use HTTPS.";
const NO_HTTP_URL_CODE = "R:NOHTTPURL";

export default class UrlRepair implements CodeActionProvider<CodeAction> {
  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] {
    const actions: CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== NO_HTTP_URL_CODE) continue;

      const originalUrl = document.getText(diagnostic.range);

      const replacementText = originalUrl.replace("http", "https");

      const action = createAction(
        NO_HTTP_URL_MSG,
        replacementText,
        document.uri,
        diagnostic.range
      );

      actions.push(action);
    }

    return actions;
  }
}
