/* --------------------------------------------------------------------------------------------
 * Copyright (c) Remy Suen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as fs from "fs";
import {
	createConnection, InitializeParams, InitializeResult, ClientCapabilities, Files,
	TextDocumentPositionParams, TextDocumentSyncKind, TextDocument, TextEdit, Hover,
	CompletionItem, CodeActionParams, Command, ExecuteCommandParams,
	DocumentSymbolParams, SymbolInformation, SignatureHelp,
	DocumentFormattingParams, DocumentRangeFormattingParams, DocumentOnTypeFormattingParams, DocumentHighlight,
	RenameParams, Range, WorkspaceEdit, Location,
	DidChangeTextDocumentParams, DidOpenTextDocumentParams, DidCloseTextDocumentParams, TextDocumentContentChangeEvent,
	DidChangeConfigurationNotification, ConfigurationItem, DocumentLinkParams, DocumentLink, MarkupKind,
	VersionedTextDocumentIdentifier, TextDocumentEdit, CodeAction, CodeActionKind, FoldingRangeRequestParam, ProposedFeatures, Diagnostic, ProgressType, CodeLensParams, CodeLens
} from 'vscode-languageserver';
import { ValidatorSettings, ValidationSeverity } from '../../dockerfile-utils/src/main';
import { CommandIds, DockerfileLanguageServiceFactory } from '../../dockerfile-language-service/src/main';
import { SemanticTokenModifiers, SemanticTokenTypes, SemanticTokensParams } from "vscode-languageserver-protocol/lib/protocol.sematicTokens.proposed";

/**
 * The settings to use for the validator if the client doesn't support
 * workspace/configuration requests.
 */
let validatorSettings: ValidatorSettings | null = null;

/**
 * The validator settings that correspond to an individual file retrieved via
 * the workspace/configuration request.
 */
let validatorConfigurations: Map<string, Thenable<ValidatorConfiguration>> = new Map();

let connection = createConnection(ProposedFeatures.all);
let service = DockerfileLanguageServiceFactory.createLanguageService();
service.setLogger({
	log(message): void {
		connection.console.log(message);
	}
});

let provideStaticAnalysis: boolean = true;

/**
 * Whether the client supports the workspace/applyEdit request.
 */
let applyEditSupport: boolean = false;

/**
 * Whether the client supports the workspace/configuration request.
 */
let configurationSupport: boolean = false;

let documentChangesSupport: boolean = false;

let codeActionQuickFixSupport: boolean = false;

let documents: { [ uri: string ]: TextDocument } = {};

/**
 * Retrieves a text document for the file located at the given URI
 * string.
 * 
 * @param uri the URI of the interested file, must be defined and not
 *            null
 * @return the text document for the file, or null if no file exists
 *         at the given location
 */
function getDocument(uri: string): PromiseLike<TextDocument> {
	if (documents[uri]) {
		return Promise.resolve(documents[uri]);
	}
	return new Promise((resolve, reject) => {
		let file = Files.uriToFilePath(uri);
		if (file === undefined) {
			resolve(null);
		} else {
			fs.exists(file, (exists) => {
				if (exists) {
					fs.readFile(file, (err, data) => {
						resolve(TextDocument.create(uri, "dockerfile", 1, data.toString()));
					});
				} else {
					resolve(null);
				}
			});
		}
	});
}

function supportsDeprecatedItems(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.deprecatedSupport;
}

function supportsSnippets(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.snippetSupport;
}

function supportsCodeActionQuickFixes(capabilities: ClientCapabilities): boolean {
	let values = capabilities.textDocument
		&& capabilities.textDocument.codeAction
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport.codeActionKind
		&& capabilities.textDocument.codeAction.codeActionLiteralSupport.codeActionKind.valueSet;
	if (values === null || values === undefined) {
		return false;
	}
	for (let value of values) {
		if (value === CodeActionKind.QuickFix) {
			return true;
		}
	}
	return false;
}

/**
 * Gets the MarkupKind[] that the client supports for the
 * documentation field of a CompletionItem.
 * 
 * @return the supported MarkupKind[], may be null or undefined
 */
function getCompletionItemDocumentationFormat(capabilities: ClientCapabilities): MarkupKind[] | null | undefined {
	return capabilities.textDocument
		&& capabilities.textDocument.completion
		&& capabilities.textDocument.completion.completionItem
		&& capabilities.textDocument.completion.completionItem.documentationFormat;
}

function getHoverContentFormat(capabilities: ClientCapabilities): MarkupKind[] {
	return capabilities.textDocument
		&& capabilities.textDocument.hover
		&& capabilities.textDocument.hover.contentFormat;
}

function getLineFoldingOnly(capabilities: ClientCapabilities): boolean {
	return capabilities.textDocument
		&& capabilities.textDocument.foldingRange
		&& capabilities.textDocument.foldingRange.lineFoldingOnly;
}

function getRangeLimit(capabilities: ClientCapabilities): number {
	let rangeLimit = capabilities.textDocument
		&& capabilities.textDocument.foldingRange
		&& capabilities.textDocument.foldingRange.rangeLimit;
	if (rangeLimit === null || rangeLimit === undefined || typeof rangeLimit === "boolean" || isNaN(rangeLimit)) {
		rangeLimit = Number.MAX_VALUE;
	} else if (typeof rangeLimit !== "number") {
		// isNaN === false and not a number, must be a string number, convert it
		rangeLimit = Number(rangeLimit);
	}
	return rangeLimit;
}

function setServiceCapabilities(capabilities: ClientCapabilities): void {
	service.setCapabilities({
		completion: {
			completionItem: {
				deprecatedSupport: supportsDeprecatedItems(capabilities),
				documentationFormat: getCompletionItemDocumentationFormat(capabilities),
				snippetSupport: supportsSnippets(capabilities)
			}
		},
		hover: {
			contentFormat: getHoverContentFormat(capabilities)
		},
		foldingRange: {
			lineFoldingOnly: getLineFoldingOnly(capabilities),
			rangeLimit: getRangeLimit(capabilities)
		}
	});
}

connection.onInitialized(() => {
	if (configurationSupport) {
		// listen for notification changes if the client supports workspace/configuration
		connection.client.register(DidChangeConfigurationNotification.type);
	}
});

connection.onInitialize((params: InitializeParams): InitializeResult => {
	setServiceCapabilities(params.capabilities);
	provideStaticAnalysis = params.initializationOptions.provideCommands;
	applyEditSupport = params.capabilities.workspace && params.capabilities.workspace.applyEdit === true && params.initializationOptions.provideCommands === true;
	documentChangesSupport = params.capabilities.workspace && params.capabilities.workspace.workspaceEdit && params.capabilities.workspace.workspaceEdit.documentChanges === true;
	configurationSupport = params.capabilities.workspace && params.capabilities.workspace.configuration === true;
	const renamePrepareSupport = params.capabilities.textDocument && params.capabilities.textDocument.rename && params.capabilities.textDocument.rename.prepareSupport === true;
	const semanticTokensSupport = params.capabilities.textDocument && (params.capabilities.textDocument as any).semanticTokens;
	codeActionQuickFixSupport = supportsCodeActionQuickFixes(params.capabilities) && params.initializationOptions.provideCommands;
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			codeActionProvider: applyEditSupport ,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: [
					'=',
					' ',
					'$',
					'-',
				]
			},
			executeCommandProvider: applyEditSupport ? {
				commands: [
					CommandIds.LOWERCASE,
					CommandIds.UPPERCASE,
					CommandIds.EXTRA_ARGUMENT,
					CommandIds.DIRECTIVE_TO_BACKSLASH,
					CommandIds.DIRECTIVE_TO_BACKTICK,
					CommandIds.FLAG_TO_CHOWN,
					CommandIds.FLAG_TO_COPY_FROM,
					CommandIds.FLAG_TO_HEALTHCHECK_INTERVAL,
					CommandIds.FLAG_TO_HEALTHCHECK_RETRIES,
					CommandIds.FLAG_TO_HEALTHCHECK_START_PERIOD,
					CommandIds.FLAG_TO_HEALTHCHECK_TIMEOUT,
					CommandIds.CONVERT_TO_AS,
					CommandIds.REMOVE_EMPTY_CONTINUATION_LINE
				]
			} :  undefined,
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			documentOnTypeFormattingProvider: {
				firstTriggerCharacter: '\\',
				moreTriggerCharacter: [ '`' ]
			},
			hoverProvider: true,
			documentSymbolProvider: true,
			documentHighlightProvider: true,
			renameProvider: renamePrepareSupport ? {
				prepareProvider: true
			} : true,
			definitionProvider: true,
			signatureHelpProvider: {
				triggerCharacters: [
					'-',
					'[',
					',',
					' ',
					'='
				]
			},
			documentLinkProvider: {
				resolveProvider: true
			},
			semanticTokensProvider: semanticTokensSupport ? {
				legend: {
					tokenTypes: [
						SemanticTokenTypes.keyword,
						SemanticTokenTypes.comment,
						SemanticTokenTypes.parameter,
						SemanticTokenTypes.property,
						SemanticTokenTypes.label,
						SemanticTokenTypes.class,
						SemanticTokenTypes.macro,
						SemanticTokenTypes.string,
						SemanticTokenTypes.variable,
					],
					tokenModifiers: [
						SemanticTokenModifiers.declaration,
						SemanticTokenModifiers.definition,
						SemanticTokenModifiers.deprecated,
						SemanticTokenModifiers.reference
					]
				}
			} : undefined,
			foldingRangeProvider: true
		} as any
	};
});

function convertValidatorConfiguration(config: ValidatorConfiguration): ValidatorSettings {
	let deprecatedMaintainer = ValidationSeverity.WARNING;
	let directiveCasing = ValidationSeverity.WARNING;
	let emptyContinuationLine = ValidationSeverity.WARNING;
	let instructionCasing = ValidationSeverity.WARNING;
	let instructionCmdMultiple = ValidationSeverity.WARNING;
	let instructionEntrypointMultiple = ValidationSeverity.WARNING;
	let instructionHealthcheckMultiple = ValidationSeverity.WARNING;
	let instructionJSONInSingleQuotes = ValidationSeverity.WARNING;
	let instructionWorkdirRelative = ValidationSeverity.WARNING;
	if (config) {
		deprecatedMaintainer = getSeverity(config.deprecatedMaintainer);
		directiveCasing = getSeverity(config.directiveCasing);
		emptyContinuationLine = getSeverity(config.emptyContinuationLine);
		instructionCasing = getSeverity(config.instructionCasing);
		instructionCmdMultiple = getSeverity(config.instructionCmdMultiple);
		instructionEntrypointMultiple = getSeverity(config.instructionEntrypointMultiple);
		instructionHealthcheckMultiple = getSeverity(config.instructionHealthcheckMultiple);
		instructionJSONInSingleQuotes = getSeverity(config.instructionJSONInSingleQuotes);
		instructionWorkdirRelative = getSeverity(config.instructionWorkdirRelative);
	}
	return {
		deprecatedMaintainer,
		directiveCasing,
		emptyContinuationLine,
		instructionCasing,
		instructionCmdMultiple,
		instructionEntrypointMultiple,
		instructionHealthcheckMultiple,
		instructionJSONInSingleQuotes,
		instructionWorkdirRelative
	};
}

function initializeWorkDoneProgressReport(){
	const randToken : string = "" + Math.round(Math.random() * 10000000);

	connection.sendRequest('window/workDoneProgress/create',{
		token: randToken
	});

	return randToken;
}

function validateTextDocument(textDocument: TextDocument): void {
	const token : string = initializeWorkDoneProgressReport();
	let hasBegun = false;

	function _sendProgress(value: string | boolean){
		if(value === true){
			endProgress(token);
			return;
		}else if(value === false){
			endProgress(token, "ERROR!");
			return;
		}

		if(!hasBegun){
			startProgress(value, token);
			hasBegun = true;
		}else{
			sendProgress(value, token);
		}
	}

	if (configurationSupport) {
		getConfiguration(textDocument.uri).then((config: ValidatorConfiguration) => {
			const fileSettings = convertValidatorConfiguration(config);
			const diagnostics = service.validate(textDocument, sendDiagnostics, _sendProgress, sendPerformanceStats, sendFilesystemData, sendCodeLenses, fileSettings);
			sendDiagnostics(textDocument.uri, diagnostics);
		});
	} else {
		const diagnostics = service.validate(textDocument, sendDiagnostics, _sendProgress, sendPerformanceStats, sendFilesystemData, sendCodeLenses, validatorSettings);
		sendDiagnostics(textDocument.uri, diagnostics);
	}
}

function startProgress(value: string, token: string){
	connection.sendProgress(new ProgressType,token,{
		"kind": "begin",
		"title": "Building",
		"cancellable": false,
		"message": value,
		// "percentage": 0
	});
}

function sendProgress(value: string, token: string){
	connection.sendProgress(new ProgressType,token,{
		"kind": "report",
		"title": "Building",
		"cancellable": false,
		"message": value,
		// "percentage": 0
	});
}

function endProgress(token: string, message?: string){
	connection.sendProgress(new ProgressType,token,{
		"kind": "end",
		"message": message
	});
}

function sendCodeLenses(documentURI: string, codeLenses: CodeLens[]){
	if(!codeLenses)
		codeLenses = [];
	connection.sendNotification("dockerlive/didChangeCodeLenses",{
		uri: documentURI,
		codeLenses: codeLenses
	});
}

function sendDiagnostics(documentURI: string, diagnostics: Diagnostic[]){
	if(!diagnostics){
		return;
		//diagnostics = [];
	}
	if(!documentURI){
		return;
	}
	if(!provideStaticAnalysis){
		diagnostics = diagnostics.filter((diag,_i,_a) => diag.source != "dockerfile-utils")
	}
	connection.sendDiagnostics({uri: documentURI, diagnostics: diagnostics});
}

function sendPerformanceStats(stats){
	connection.sendNotification("dockerlive/performanceStats", stats);
}

function sendFilesystemData(data){
	connection.sendNotification("dockerlive/filesystemData", {data: data});
}

connection.onNotification("dockerlive/toggle", () => {
	service.toggleAnalysis();
});

connection.onNotification("dockerlive/stop", () => {
	service.stopAnalysis();
});

connection.onNotification("dockerlive/restart", () => {
	service.restartAnalysis();
});

connection.onNotification("dockerlive/getContainerName", () => {
	connection.sendNotification("dockerlive/containerName", {
		containerName: service.currentContainerName()
	});
});

connection.onNotification("dockerlive/forceValidation", () => {
	for (const key in documents) {
		validateTextDocument(documents[key]);
	}
})

interface ValidatorConfiguration {
	deprecatedMaintainer?: string;
	directiveCasing?: string;
	emptyContinuationLine?: string;
	instructionCasing?: string;
	instructionCmdMultiple?: string;
	instructionEntrypointMultiple?: string;
	instructionHealthcheckMultiple?: string;
	instructionJSONInSingleQuotes?: string;
	instructionWorkdirRelative?: string;
}

interface Settings {
	docker: {
		languageserver: {
			diagnostics?: ValidatorConfiguration
		}
	};
}

function getSeverity(severity: string | undefined): ValidationSeverity | null {
	switch (severity) {
		case "ignore":
			return ValidationSeverity.IGNORE;
		case "warning":
			return ValidationSeverity.WARNING;
		case "error":
			return ValidationSeverity.ERROR;
	}
	return null;
}

/**
 * Gets the validation configuration that pertains to the specified resource.
 * 
 * @param resource the interested resource
 * @return the configuration to use to validate the interested resource
 */
function getConfiguration(resource: string): Thenable<ValidatorConfiguration> {
	let result = validatorConfigurations.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({ section: "docker.languageserver.diagnostics", scopeUri: resource });
		validatorConfigurations.set(resource, result);
	}
	return result;
}

// listen for notifications when the client's configuration has changed
connection.onNotification(DidChangeConfigurationNotification.type, () => {
	refreshConfigurations();
});

/**
 * Wipes and reloads the internal cache of validator configurations.
 */
function refreshConfigurations() {
	// store all the URIs that need to be refreshed
	const settingsRequest: ConfigurationItem[] = [];
	for (let uri in documents) {
		settingsRequest.push({ section: "docker.languageserver.diagnostics", scopeUri: uri });
	}
	// clear the cache
	validatorConfigurations.clear();

	// ask the workspace for the configurations
	connection.workspace.getConfiguration(settingsRequest).then((values: ValidatorConfiguration[]) => {
		const toRevalidate: string[] = [];
		for (let i = 0; i < values.length; i++) {
			const resource = settingsRequest[i].scopeUri;
			// a value might have been stored already, use it instead and ignore this one if so
			if (values[i] && !validatorConfigurations.has(resource)) {
				validatorConfigurations.set(resource, Promise.resolve(values[i]));
				toRevalidate.push(resource);
			}
		}

		for (const resource of toRevalidate) {
			validateTextDocument(documents[resource]);
		}
	});
}

connection.onDidChangeConfiguration((change) => {
	if (configurationSupport) {
		refreshConfigurations();
	} else {
		let settings = <Settings>change.settings;
		if (settings.docker && settings.docker.languageserver && settings.docker.languageserver.diagnostics) {
			validatorSettings = convertValidatorConfiguration(settings.docker.languageserver.diagnostics);
		} else {
			validatorSettings = convertValidatorConfiguration(null);
		}
		// validate all the documents again
		Object.keys(documents).forEach((key) => {
			validateTextDocument(documents[key]);
		});
	}
});

connection.onDidOpenTextDocument((didOpenTextDocumentParams: DidOpenTextDocumentParams): void => {
	let document = TextDocument.create(didOpenTextDocumentParams.textDocument.uri, didOpenTextDocumentParams.textDocument.languageId, didOpenTextDocumentParams.textDocument.version, didOpenTextDocumentParams.textDocument.text);
	documents[didOpenTextDocumentParams.textDocument.uri] = document;
	validateTextDocument(document);
});

connection.onDidChangeTextDocument((didChangeTextDocumentParams: DidChangeTextDocumentParams): void => {
	let document = documents[didChangeTextDocumentParams.textDocument.uri];
	let buffer = document.getText();
	let content = buffer;
	let changes = didChangeTextDocumentParams.contentChanges;
	for (let i = 0; i < changes.length; i++) {
		const change = changes[i] as any;
		if (!change.range && !change.rangeLength) {
			// no ranges defined, the text is the entire document then
			buffer = change.text;
			break;
		}

		let offset = document.offsetAt(change.range.start);
		let end = null;
		if (change.range.end) {
			end = document.offsetAt(change.range.end);
		} else {
			end = offset + change.rangeLength;
		}
		buffer = buffer.substring(0, offset) + change.text + buffer.substring(end);
	}
	document = TextDocument.create(didChangeTextDocumentParams.textDocument.uri, document.languageId, didChangeTextDocumentParams.textDocument.version, buffer);
	documents[didChangeTextDocumentParams.textDocument.uri] = document;
	if (content !== buffer) {
		validateTextDocument(document);
	}
});

connection.onDidCloseTextDocument((didCloseTextDocumentParams: DidCloseTextDocumentParams): void => {
	validatorConfigurations.delete(didCloseTextDocumentParams.textDocument.uri);
	connection.sendDiagnostics({ uri: didCloseTextDocumentParams.textDocument.uri, diagnostics: [] });
	delete documents[didCloseTextDocumentParams.textDocument.uri];
});

connection.onCompletion((textDocumentPosition: TextDocumentPositionParams): PromiseLike<CompletionItem[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeCompletionItems(document.getText(), textDocumentPosition.position);
		}
		return null;
	});
});

connection.onSignatureHelp((textDocumentPosition: TextDocumentPositionParams): PromiseLike<SignatureHelp> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res({
			signatures: [],
			activeSignature: null,
			activeParameter: null,
		}));
	}
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document !== null) {
			return service.computeSignatureHelp(document.getText(), textDocumentPosition.position);
		}
		return {
			signatures: [],
			activeSignature: null,
			activeParameter: null,
		};
	});
});

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	return service.resolveCompletionItem(item);
});

connection.onHover((textDocumentPosition: TextDocumentPositionParams): PromiseLike<Hover> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res(null));
	}
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeHover(document.getText(), textDocumentPosition.position);
		}
		return null;
	});
});

connection.onDocumentHighlight((textDocumentPosition: TextDocumentPositionParams): PromiseLike<DocumentHighlight[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeHighlightRanges(document.getText(), textDocumentPosition.position);
		}
		return [];
	});
});

connection.onCodeAction((codeActionParams: CodeActionParams): Command[] | PromiseLike<CodeAction[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	if (applyEditSupport && codeActionParams.context.diagnostics.length > 0) {
		let commands = service.computeCodeActions(codeActionParams.textDocument, codeActionParams.range, codeActionParams.context);
		if (codeActionQuickFixSupport) {
			return getDocument(codeActionParams.textDocument.uri).then((document) => {
				let codeActions = [];
				for (let command of commands) {
					let codeAction: CodeAction = {
						title: command.title,
						kind: CodeActionKind.QuickFix
					};
					let edit = computeWorkspaceEdit(codeActionParams.textDocument.uri, document, command.command, command.arguments);
					if (edit) {
						codeAction.edit = edit;
					}
					codeActions.push(codeAction);
				}
				return codeActions;
			});
		}
		return commands;
	}
	return [];
});

function computeWorkspaceEdit(uri: string, document: TextDocument, command: string, args: any[]): WorkspaceEdit {
	if(!provideStaticAnalysis){
		return null;
	}
	let edits = service.computeCommandEdits(document.getText(), command, args);
	if (edits) {
		if (documentChangesSupport) {
			let identifier = VersionedTextDocumentIdentifier.create(uri, document.version);
			return {
				documentChanges: [
					TextDocumentEdit.create(identifier, edits)
				]
			};
		} else {
			return {
				changes: {
					[ uri ]: edits
				}
			};
		}
	}
	return null;
}

connection.onExecuteCommand((params: ExecuteCommandParams): void => {
	if (applyEditSupport) {
		let uri: string = params.arguments[0];
		getDocument(uri).then((document) => {
			if (document) {
				let workspaceEdit = computeWorkspaceEdit(uri, document, params.command, params.arguments);
				if (workspaceEdit) {
					connection.workspace.applyEdit(workspaceEdit);
				}
			}
			return null;
		});
	}
});

connection.onDefinition((textDocumentPosition: TextDocumentPositionParams): PromiseLike<Location> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res(null));
	}
	return getDocument(textDocumentPosition.textDocument.uri).then((document) => {
		if (document) {
			return service.computeDefinition(textDocumentPosition.textDocument, document.getText(), textDocumentPosition.position);
		}
		return null;
	});
});

connection.onRenameRequest((params: RenameParams): PromiseLike<WorkspaceEdit> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res(null));
	}
	return getDocument(params.textDocument.uri).then((document) => {
		if (document) {
			let edits = service.computeRename(params.textDocument, document.getText(), params.position, params.newName);
			return {
				changes: {
					[ params.textDocument.uri ]: edits
				}
			};
		}
		return null;
	});
});

connection.onPrepareRename((params: TextDocumentPositionParams): PromiseLike<Range> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res(null));
	}
	return getDocument(params.textDocument.uri).then((document) => {
		if (document) {
			return service.prepareRename(document.getText(), params.position);
		}
		return null;
	});
});

connection.onDocumentSymbol((documentSymbolParams: DocumentSymbolParams): PromiseLike<SymbolInformation[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(documentSymbolParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSymbols(documentSymbolParams.textDocument, document.getText());
		}
		return [];
	});
});

connection.onDocumentFormatting((documentFormattingParams: DocumentFormattingParams): PromiseLike<TextEdit[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(documentFormattingParams.textDocument.uri).then((document) => {
		if (document) {
			return service.format(document.getText(), documentFormattingParams.options);
		}
		return [];
	});
});	

connection.onDocumentRangeFormatting((rangeFormattingParams: DocumentRangeFormattingParams): PromiseLike<TextEdit[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(rangeFormattingParams.textDocument.uri).then((document) => {
		if (document) {
			return service.formatRange(document.getText(), rangeFormattingParams.range, rangeFormattingParams.options);
		}
		return [];
	});
});

connection.onDocumentOnTypeFormatting((onTypeFormattingParams: DocumentOnTypeFormattingParams): PromiseLike<TextEdit[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(onTypeFormattingParams.textDocument.uri).then((document) => {
		if (document) {
			return service.formatOnType(document.getText(), onTypeFormattingParams.position, onTypeFormattingParams.ch, onTypeFormattingParams.options);
		}
		return [];
	});
});

connection.onDocumentLinks((documentLinkParams: DocumentLinkParams): PromiseLike<DocumentLink[]> => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(documentLinkParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeLinks(document.getText());
		}
		return [];
	});
});

connection.onDocumentLinkResolve((documentLink: DocumentLink): DocumentLink => {
	return service.resolveLink(documentLink);
});

connection.onFoldingRanges((foldingRangeParams: FoldingRangeRequestParam) => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res([]));
	}
	return getDocument(foldingRangeParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeFoldingRanges(document.getText());
		}
		return [];
	});
});

connection.languages.semanticTokens.on((semanticTokenParams: SemanticTokensParams) => {
	if(!provideStaticAnalysis){
		return new Promise((res) => res({
			data: []
		}));
	}
	return getDocument(semanticTokenParams.textDocument.uri).then((document) => {
		if (document) {
			return service.computeSemanticTokens(document.getText());
		}
		return {
			data: []
		};
	});
});

// setup complete, start listening for a client connection
connection.listen();