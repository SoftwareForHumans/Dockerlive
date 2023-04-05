import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Range,
  Selection,
  TextDocument,
} from "vscode";
import { createAction, isNodeProject } from "./common";

const NO_IMAGE_PIN_MSG = "Pin image version.";
const NO_IMAGE_PIN_CODE = "R:NOIMAGEPIN";

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
      if (diagnostic.code !== NO_IMAGE_PIN_CODE) continue;

      const replacementText = getReplacementText(document);

      const action = createAction(
        NO_IMAGE_PIN_MSG,
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
  const isNode = isNodeProject(document);
  if (isNode) return "FROM node:18-slim";
  return "FROM python:3.11-slim";
}
