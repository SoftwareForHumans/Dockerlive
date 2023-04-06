import { Dockerfile, Instruction } from "dockerfile-ast";
import {
  Diagnostic,
  Range,
  DiagnosticSeverity,
} from "vscode-languageserver-types";

export function getRangeBeforeEnd(dockerfile: Dockerfile): Range | null {
  const instructions = dockerfile.getInstructions();

  if (!instructions || instructions.length === 0) return null;

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

export function getRangeAfterFrom(dockerfile: Dockerfile): Range | null {
  const froms = dockerfile.getFROMs();

  if (!froms || froms.length === 0) return null;

  const fromLine = froms[0].getRange().start.line;

  const range = {
    start: { character: 0, line: fromLine + 1 },
    end: { character: 3, line: fromLine + 1 },
  };

  return range;
}

export function getInstructionsWithKeyword(
  dockerfile: Dockerfile,
  keyword: string
): Instruction[] {
  return dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === keyword);
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
