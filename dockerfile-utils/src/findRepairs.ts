import { Argument, Dockerfile, Instruction } from "dockerfile-ast";
import {
  Diagnostic,
  Range,
  DiagnosticSeverity,
} from "vscode-languageserver-types";

export default function checkRepairableProblems(
  dockerfile: Dockerfile
): Diagnostic[] {
  const problems: Diagnostic[] = [];

  problems.push(...checkAptProblems(dockerfile));

  return problems;
}

export function checkAptProblems(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const aptInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "RUN")
    .filter(
      (instruction) =>
        instruction
          .getArguments()
          .map((arg) => arg.getValue())
          .find((argValue) => argValue === "apt-get") !== undefined
    );

  if (aptInstructions.length === 0) return [];
  
  aptInstructions.forEach((instruction) => {
    const args = instruction.getArguments();
    const aptGetArg = args.find((arg) => arg.getValue() === "apt-get");
    const installArg = args.find((arg) => arg.getValue() === "install");

    if (installArg === undefined) return; //goes to next iteration

    const noInstallRecommendsProblem = checkNoInstallRecommends(aptGetArg, installArg, args)
    if (noInstallRecommendsProblem !== undefined) problems.push(noInstallRecommendsProblem);
  })

  return problems;
}

function checkNoInstallRecommends(aptGetArg: Argument, installArg: Argument, args: Argument[]): Diagnostic | undefined {
  if (args.find((arg) => arg.getValue() === "--no-install-recommends")) return;
  const range: Range = {
    start: aptGetArg.getRange().start,
    end: installArg.getRange().end,
  };
  return createRepairDiagnostic(
    range,
    "The --no-install-recommends option is not being used with apt-get install.",
    "NOINSTALLRECOMMENDS"
  );
}

function createRepairDiagnostic(
  range: Range,
  message: string,
  codeSuffix: string
): Diagnostic {
  return {
    range,
    message,
    code: "R:" + codeSuffix,
    severity: DiagnosticSeverity.Warning,
    source: "repair-module",
  };
}
