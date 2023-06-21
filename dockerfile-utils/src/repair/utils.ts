import { Dockerfile, Instruction } from "dockerfile-ast";
import {
  Diagnostic,
  Range,
  DiagnosticSeverity,
  Position,
} from "vscode-languageserver-types";

export function getRangeBeforeEnd(dockerfile: Dockerfile): Range | null {
  const instructions = dockerfile.getInstructions();

  if (!instructions || instructions.length <= 1) return null;

  const finalInstruction = instructions[instructions.length - 1];

  const line = finalInstruction.getRange().start.line - 1;

  const range = {
    start: { character: 0, line },
    end: { character: 3, line },
  };

  return range;
}

export function getDistroUsed(dockerfile: Dockerfile): string {
  const froms = dockerfile.getFROMs();

  if (!froms || froms.length === 0) return "debian";

  const imageTag = froms[0].getImageTag();

  const hasAlpineInImageTag = imageTag !== null && imageTag.includes("alpine");

  if (hasAlpineInImageTag) return "alpine";

  const apkMentions = dockerfile.getInstructions().filter((instruction) =>
    instruction
      .getArguments()
      .map((arg) => arg.getValue())
      .includes("apk")
  );

  if (apkMentions && apkMentions.length > 0) return "alpine";

  return "debian";
}

export function getRangeAfterCopy(dockerfile: Dockerfile): Range | null {
  const instructions = dockerfile.getInstructions();
  const copys = dockerfile.getCOPYs();

  if (!copys || copys.length === 0) return null;
  if (!instructions || instructions.length <= 1) return null;

  const copyLine = copys[0].getRange().start.line;

  const rangeLine = copyLine + 1;

  const range = {
    start: { character: 0, line: rangeLine },
    end: { character: 3, line: rangeLine },
  };

  return range;
}

export function getRangeAfterFrom(dockerfile: Dockerfile): Range | null {
  const instructions = dockerfile.getInstructions();
  const froms = dockerfile.getFROMs();

  if (!froms || froms.length === 0) return null;
  if (!instructions || instructions.length <= 1) return null;

  const fromLine = froms[0].getRange().start.line;

  const range = {
    start: { character: 0, line: fromLine + 1 },
    end: { character: 3, line: fromLine + 1 },
  };

  return range;
}

export function getRunInstructionsWithArg(
  dockerfile: Dockerfile,
  arg: string
): Instruction[] {
  return getInstructionsWithKeyword(dockerfile, "RUN").filter((instruction) =>
    instruction
      .getArguments()
      .map((argument) => argument.getValue())
      .includes(arg)
  );
}

export function getInstructionsWithKeyword(
  dockerfile: Dockerfile,
  keyword: string
): Instruction[] {
  return dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === keyword);
}

export function restrictRange(
  instruction: Instruction,
  keyword: string
): Range | null {
  try {
    const args = instruction.getArguments();

    let inDesiredRange = false,
      start: Position,
      end: Position;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg) continue;

      if (arg.getValue() === "&&") {
        if (inDesiredRange) {
          inDesiredRange = false;
          end = args[i - 1].getRange().end;
        } else continue;
      }

      if (arg.getValue() === keyword) {
        if (i === 0) {
          inDesiredRange = true;
          start = arg.getRange().start;
        } else if (args[i - 1].getValue() === "&&") {
          inDesiredRange = true;
          start = arg.getRange().start;
        }
      }
    }
    if (inDesiredRange) end = args[args.length - 1].getRange().end;

    return { start, end };
  } catch (e) {
    return null;
  }
}

export function getProjectLang(dockerfile: Dockerfile): string {
  const froms = dockerfile.getFROMs();

  if (!froms || froms.length === 0) return "node";

  const image = froms[0].getImage();

  if (image === "python") return "python";

  return "node";
}

export function createRepairDiagnostic(
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
