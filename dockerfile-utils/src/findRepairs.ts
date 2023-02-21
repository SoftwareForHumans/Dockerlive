import { Dockerfile, Instruction } from "dockerfile-ast";
import {
  Diagnostic,
  CodeAction,
  CodeActionKind,
  WorkspaceEdit,
  TextEdit,
  Position,
  TextDocumentEdit,
  VersionedTextDocumentIdentifier,
  Range,
  DiagnosticSeverity,
} from "vscode-languageserver-types";

export function checkNoInstallRecommends(
    dockerfile: Dockerfile,
  ): Diagnostic | undefined {
    const runInstructions = dockerfile
      .getInstructions()
      .filter((instruction) => instruction.getKeyword() === "RUN");
    const aptInstructions: Instruction[] = [];
    runInstructions.forEach((instruction) => {
      const args = instruction.getArguments().map((arg) => arg.getValue());
      const aptArg = args.filter((arg) => arg.includes("apt-get"));
      const installArg = args.filter((arg) => arg.includes("install"));
      if (aptArg.length > 0 && installArg.length > 0)
        aptInstructions.push(instruction);
    });

    if (aptInstructions.length === 0) return;

    const instruction = aptInstructions[0]; //assuming there is only one instance of apt-get install

    const args = instruction.getArguments();
    const noInstallRecommendsArg = args.filter((arg) =>
      arg.getValue().includes("--no-install-recommends")
    );
    if (noInstallRecommendsArg.length > 0) return;

    const aptArg = args.find((arg) => arg.getValue().includes("apt-get"));
    const installArg = args.find((arg) => arg.getValue().includes("install"));
    const range: Range = {
      start: aptArg!!.getRange().start,
      end: installArg!!.getRange().end,
    };

    return {
      range,
      message:
        "The --no-install-recommends option is not being used with apt-get install.",
      code: "R:NOINSTALLRECOMMENDS",
      severity: DiagnosticSeverity.Warning,
      source: "repair-module",
    };
  }
