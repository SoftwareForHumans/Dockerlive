import { Dockerfile } from 'dockerfile-ast';
import { CodeAction, Diagnostic, VersionedTextDocumentIdentifier } from 'vscode-languageserver-types';

export default interface Repair {
	getDiagnostic(dockerfile: Dockerfile, docId: VersionedTextDocumentIdentifier) : Diagnostic | undefined
}