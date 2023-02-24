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
  problems.push(...checkConsecutiveRunInstructions(dockerfile));

  return problems;
}

function checkConsecutiveRunInstructions(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const instructions = dockerfile.getInstructions();

  for (let i = 1; i < instructions.length; i++) {
    const currentinstruction = instructions[i];
    const previousInstruction = instructions[i - 1];

    const currentInstructionKeyword = currentinstruction.getKeyword();
    const previousInstructionKeyword = previousInstruction.getKeyword();

    const areConsecutiveRunInstructions =
      currentInstructionKeyword === previousInstructionKeyword &&
      currentInstructionKeyword == "RUN";

    if (areConsecutiveRunInstructions) {
      const range = {
        start: previousInstruction.getRange().start,
        end: currentinstruction.getRange().end,
      };

      const problem = createRepairDiagnostic(
        range,
        "Consecutive RUN instructions should be merged to minimize the number of layers.",
        "CONSECUTIVERUN"
      );
      
      problems.push(problem);
    }
  }

  return problems;
}

function checkAptProblems(dockerfile: Dockerfile): Diagnostic[] {
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

    const missingElementProblems = checkMissingElements(
      aptGetArg,
      installArg,
      args
    );
    if (missingElementProblems.length > 0)
      problems.push(...missingElementProblems);
  });

  return problems;
}

function checkMissingElements(
  aptGetArg: Argument,
  installArg: Argument,
  args: Argument[]
): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const range: Range = {
    start: aptGetArg.getRange().start,
    end: installArg.getRange().end,
  };

  if (
    args.find((arg) => arg.getValue() === "--no-install-recommends") ===
    undefined
  )
    problems.push(createNoInstallRecommendsDiagnostic(range));

  if (
    args.find((arg) => arg.getValue() === "update") === undefined &&
    args.find((arg) => arg.getValue() === "-y") !== undefined
  )
    problems.push(createUpdateBeforeInstallDiagnostic(range));

  if (args.find((arg) => arg.getValue() === "-y") === undefined)
    problems.push(createConfirmInstallDiagnostic(range));

  return problems;
}

function createNoInstallRecommendsDiagnostic(range: Range): Diagnostic {
  return createRepairDiagnostic(
    range,
    "The --no-install-recommends option should be used with apt-get install.",
    "NOINSTALLRECOMMENDS"
  );
}

function createConfirmInstallDiagnostic(range: Range): Diagnostic {
  return createRepairDiagnostic(
    range,
    "The -y option should be used with apt-get install.",
    "CONFIRMINSTALL"
  );
}

function createUpdateBeforeInstallDiagnostic(range: Range): Diagnostic {
  return createRepairDiagnostic(
    range,
    "The apt-get update command should be executed before apt-get install.",
    "UPDATEBEFOREINSTALL"
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
