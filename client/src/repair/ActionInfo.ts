import { Range } from 'vscode';

export default interface ActionInfo {
	replacementText: string,
	range: Range
}