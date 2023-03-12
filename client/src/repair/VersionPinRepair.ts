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
import * as vscode from "vscode";
import { createAction } from "./common";
import * as os from "os";

export default class VersionPinRepair
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
      if (diagnostic.code !== "R:NOIMAGEPIN") continue;

		const replacementText = getReplacementText(document);

      const action = createAction(
        "Pin image version.",
        replacementText,
        document.uri,
        diagnostic.range
      );

      actions.push(action);
    }

    return actions;
  }
}

function getReplacementText(document: TextDocument): string {
	const documentText = document.getText();
	const fromIndex = documentText.indexOf("FROM");
	const imageIndex = fromIndex + "FROM ".length;
	const image = documentText.substring(imageIndex, imageIndex + "python".length);
	const isNode = image.startsWith("node");
	if (isNode) return "FROM node:18-slim";
	return "FROM python:3.11-slim";
}
