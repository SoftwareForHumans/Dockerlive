import { Dockerfile, DockerfileParser, Instruction } from "dockerfile-ast";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { Diagnostic } from "vscode-languageserver-types";
import {
  createRepairDiagnostic,
  getDistroUsed,
  getProjectLang,
  getRangeAfterCopy,
  getRangeAfterFrom,
  getRangeBeforeEnd,
  getRunInstructionsWithArg,
} from "./utils";

const HERMIT_PORTS_MSG_1 = "Some ports that could be exposed were detected.";
const HERMIT_PORTS_MSG_2 =
  "Some mistakes were detected with the ports being exposed.";
const HERMIT_PORTS_SUFFIX = "HERMITPORTS";

const HERMIT_DEPS_MSG_1 =
  "Some dependencies that are missing from this Dockerfile have been detected.";
const HERMIT_DEPS_MSG_2 =
  "The dependencies being installed don't match the detected ones.";
const HERMIT_DEPS_SUFFIX = "HERMITDEPS";

const HERMIT_LANG_DEPS_MSG =
  "Some commands that are needed to install dependencies are missing.";
const HERMIT_LANG_DEPS_SUFFIX = "HERMITLANGDEPS";

let hermitDockerfileContent: string = null;

export default function checkHermitAlternative(
  dockerfile: Dockerfile
): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const hermitDockerfilePath = "Dockerfile.hermit";
  const hermitDockerfileExists = existsSync(hermitDockerfilePath);

  if (hermitDockerfileExists) {
    hermitDockerfileContent = readFileSync(hermitDockerfilePath).toString();
    unlinkSync(hermitDockerfilePath);
  } else if (!hermitDockerfileExists && hermitDockerfileContent === null)
    return [];

  const hermitDockerfile = DockerfileParser.parse(hermitDockerfileContent);

  const dependenciesProblem = checkHermitDependencies(
    dockerfile,
    hermitDockerfile
  );
  if (dependenciesProblem !== null) problems.push(dependenciesProblem);

  const portsProblem = checkHermitPorts(dockerfile, hermitDockerfile);
  if (portsProblem !== null) problems.push(portsProblem);

  const languageDepsProblem = checkHermitLanguageDeps(
    dockerfile,
    hermitDockerfile
  );
  if (languageDepsProblem !== null) problems.push(languageDepsProblem);

  return problems;
}

function checkHermitLanguageDeps(
  dockerfile: Dockerfile,
  hermitDockerfile: Dockerfile
): Diagnostic | null {
  const lang = getProjectLang(dockerfile);

  const languageKeywords = lang === "node" ? ["npm"] : ["pip", "pip3"];

  const originalInstructions: Instruction[] = [];

  const hermitInstructions: Instruction[] = [];

  languageKeywords.forEach((keyword) => {
    originalInstructions.push(
      ...getRunInstructionsWithArg(dockerfile, keyword)
    );
    hermitInstructions.push(
      ...getRunInstructionsWithArg(hermitDockerfile, keyword)
    );
  });

  const range = getRangeAfterCopy(dockerfile);

  if (!range) return null;

  if (originalInstructions.length === 0 && hermitInstructions.length > 0)
    return createRepairDiagnostic(
      range,
      HERMIT_LANG_DEPS_MSG,
      HERMIT_LANG_DEPS_SUFFIX
    );

  return null;
}

function checkHermitPorts(
  dockerfile: Dockerfile,
  hermitDockerfile: Dockerfile
): Diagnostic | null {
  const originalExposeInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "EXPOSE");

  const hermitExposeInstructions = hermitDockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "EXPOSE");

  if (
    hermitExposeInstructions.length > 0 &&
    originalExposeInstructions.length === 0
  ) {
    const range = getRangeBeforeEnd(dockerfile);
    if (!range) return null;

    return createRepairDiagnostic(
      range,
      HERMIT_PORTS_MSG_1,
      HERMIT_PORTS_SUFFIX
    );
  } else if (
    hermitExposeInstructions.length > 0 &&
    originalExposeInstructions.length > 0
  ) {
    const originalPorts = originalExposeInstructions.map((instruction) => {
      const args = instruction.getArguments();
      if (!args || args.length === 0) return;
      return args[0].getValue();
    });
    if (
      !originalPorts ||
      originalPorts.length === 0 ||
      originalPorts.includes(undefined)
    )
      return null;

    const hermitPorts = hermitExposeInstructions.map((instruction) => {
      const args = instruction.getArguments();
      if (!args || args.length === 0) return;
      return args[0].getValue();
    });
    if (
      !hermitPorts ||
      hermitPorts.length === 0 ||
      hermitPorts.includes(undefined)
    )
      return null;

    let needToRepair = false;

    hermitPorts.forEach((port) => {
      if (!port) return;
      if (!originalPorts.includes(port)) needToRepair = true;
    });

    originalPorts.forEach((port) => {
      if (!port) return;
      if (!hermitPorts.includes(port)) needToRepair = true;
    });

    const start = originalExposeInstructions[0].getRange().start;

    const end =
      originalExposeInstructions[
        originalExposeInstructions.length - 1
      ].getRange().end;

    const range = {
      start,
      end,
    };

    if (needToRepair)
      return createRepairDiagnostic(
        range,
        HERMIT_PORTS_MSG_2,
        HERMIT_PORTS_SUFFIX
      );
  }

  return null;
}

function checkHermitDependencies(
  dockerfile: Dockerfile,
  hermitDockerfile: Dockerfile
): Diagnostic | null {
  const distro = getDistroUsed(dockerfile);

  if (distro !== "") {
    const packageManagerKeyword = distro === "debian" ? "apt-get" : "apk";

    const hermitPkgInstructions = hermitDockerfile
      .getInstructions()
      .filter((instruction) =>
        instruction
          .getArguments()
          .map((arg) => arg.getValue())
          .includes(packageManagerKeyword)
      );

    const originalPkgInstructions = dockerfile
      .getInstructions()
      .filter((instruction) =>
        instruction
          .getArguments()
          .map((arg) => arg.getValue())
          .includes(packageManagerKeyword)
      );

    if (
      hermitPkgInstructions.length > 0 &&
      originalPkgInstructions.length === 0
    ) {
      const range = getRangeAfterFrom(dockerfile);

      if (!range) return null;

      return createRepairDiagnostic(
        range,
        HERMIT_DEPS_MSG_1,
        HERMIT_DEPS_SUFFIX
      );
    } else if (
      hermitPkgInstructions.length > 0 &&
      originalPkgInstructions.length > 0
    ) {
      const originalDeps = getDepsFromInstructions(
        originalPkgInstructions,
        packageManagerKeyword
      );
      const hermitDeps = getDepsFromInstructions(
        hermitPkgInstructions,
        packageManagerKeyword
      );

      const filesHaveSameDeps = areArraysEqual(originalDeps, hermitDeps);

      const start = originalPkgInstructions[0].getRange().start;
      const end =
        originalPkgInstructions[originalPkgInstructions.length - 1].getRange()
          .end;

      const range = { start, end };

      if (!filesHaveSameDeps)
        return createRepairDiagnostic(
          range,
          HERMIT_DEPS_MSG_2,
          HERMIT_DEPS_SUFFIX
        );
    }
  }

  return null;
}

function getDepsFromInstructions(
  instructions: Instruction[],
  keyword: string
): string[] {
  const result = [];

  instructions.forEach((instruction) => {
    const args = instruction.getArguments();
    if (!args || args.length === 0) return;

    const argValues = args.map((arg) => arg.getValue());

    const deps = processDeps(argValues, keyword);

    result.push(...deps);
  });

  return result;
}

function processDeps(args: string[], keyword: string): string[] {
  const deps = [];
  let gatheringDeps = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "&&") gatheringDeps = false;

    if (arg.startsWith("-")) continue;

    if (gatheringDeps) deps.push(arg);

    if (arg === keyword && keyword === "apt-get" && args[i + 1] === "update")
      continue;

    if (arg === keyword) {
      const secondKeyword = keyword === "apt-get" ? "install" : "add";
      if (args[i + 1] === secondKeyword) {
        gatheringDeps = true;
        i++;
      }
    }
  }

  return deps;
}

function areArraysEqual(list1: string[], list2: string[]): boolean {
  if (list1.length !== list2.length) return false;
  const sortedList1 = list1.sort();
  const sortedList2 = list2.sort();

  for (let i = 0; i < sortedList1.length; i++) {
    const element1 = sortedList1[i];
    const element2 = sortedList2[i];

    if (element1 !== element2) return false;
  }

  return true;
}
