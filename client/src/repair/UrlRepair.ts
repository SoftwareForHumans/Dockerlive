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
  
  export default class UrlRepair
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
		if (diagnostic.code !== "R:NOHTTPURL") continue;
  
		const originalUrl = document.getText(diagnostic.range);

		const replacementText = originalUrl.replace("http", "https");
		
		const action = createAction(
		  "Change the URL to use HTTPS.",
		  replacementText,
		  document.uri,
		  diagnostic.range
		);
  
		actions.push(action);
	  }
  
	  return actions;
	}
  }
  