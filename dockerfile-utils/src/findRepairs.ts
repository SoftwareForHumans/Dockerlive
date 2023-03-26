import {
  Argument,
  Dockerfile,
  DockerfileParser,
  Instruction,
} from "dockerfile-ast";
import { existsSync, readFileSync } from "fs";
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
  problems.push(...checkUnsuitableInstructions(dockerfile));
  problems.push(...checkCdUsage(dockerfile));
  problems.push(...checkNetworkUtils(dockerfile));
  problems.push(...checkApkProblems(dockerfile));
  problems.push(...checkVersionPinning(dockerfile));
  problems.push(...checkCopys(dockerfile));
  problems.push(...checkWorkDir(dockerfile));
  problems.push(...checkUser(dockerfile));
  problems.push(...checkHermitAlternative(dockerfile));

  return problems;
}

function checkUser(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const userInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "USER");

  if (userInstructions.length === 0) {
    const range = getRangeBeforeEnd(dockerfile);

    problems.push(
      createRepairDiagnostic(
        range,
        "A user other than root should be used.",
        "NOROOTUSER"
      )
    );
  }

  return problems;
}

function checkHermitAlternative(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const hermitDockerfilePath = "Dockerfile.hermit";
  const hermitDockerfileExists = existsSync(hermitDockerfilePath);

  if (!hermitDockerfileExists) return [];

  const hermitDockerfileContent = readFileSync(hermitDockerfilePath).toString();
  const hermitDockerfile = DockerfileParser.parse(hermitDockerfileContent);

  const dependenciesProblem = checkHermitDependencies(
    dockerfile,
    hermitDockerfile
  );
  if (dependenciesProblem !== null) problems.push(dependenciesProblem);

  const portsProblem = checkHermitPorts(dockerfile, hermitDockerfile);
  if (portsProblem !== null) problems.push(portsProblem);

  return problems;
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

  const range = getRangeBeforeEnd(dockerfile);

  if (
    hermitExposeInstructions.length > 0 &&
    originalExposeInstructions.length === 0
  ) {
    return createRepairDiagnostic(
      range,
      "Hermit detected some ports that could be exposed.",
      "HERMITPORTS"
    );
  }

  return null;
}

function getRangeBeforeEnd(dockerfile: Dockerfile): Range {
  const instructions = dockerfile.getInstructions();

  const finalInstruction = instructions[instructions.length - 1];

  const line = finalInstruction.getRange().start.line - 1;

  const range = {
    start: { character: 0, line },
    end: { character: 3, line },
  };

  return range;
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

    const range = getRangeAfterFrom(dockerfile);

    if (
      hermitPkgInstructions.length > 0 &&
      originalPkgInstructions.length === 0
    ) {
      return createRepairDiagnostic(
        range,
        "Hermit detected some dependencies that are missing from this Dockerfile.",
        "HERMITDEPS"
      );
    }
  }

  return null;
}

function getDistroUsed(dockerfile: Dockerfile): string {
  const imageTag = dockerfile.getFROMs()[0].getImageTag();

  const hasAlpineInImageTag = imageTag !== null && imageTag.includes("alpine");

  if (hasAlpineInImageTag) return "alpine";

  const apkMentions = dockerfile.getInstructions().filter((instruction) =>
    instruction
      .getArguments()
      .map((arg) => arg.getValue())
      .includes("apk")
  );

  if (apkMentions.length > 0) return "alpine";

  return "debian";
}

function checkWorkDir(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const workdirInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "WORKDIR");

  const range = getRangeAfterFrom(dockerfile);

  if (workdirInstructions.length === 0)
    problems.push(
      createRepairDiagnostic(
        range,
        "A working directory other than / should be used.",
        "NOROOTDIR"
      )
    );

  return problems;
}

function getRangeAfterFrom(dockerfile: Dockerfile): Range {
  const fromLine = dockerfile.getFROMs()[0].getRange().start.line;

  const range = {
    start: { character: 0, line: fromLine + 1 },
    end: { character: 3, line: fromLine + 1 },
  };

  return range;
}

function checkCopys(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const copys = dockerfile.getCOPYs();

  if (copys.length === 1)
    problems.push(
      createRepairDiagnostic(
        copys[0].getRange(),
        "Two COPY instructions should be used, one to copy the files required for installing dependencies and another to copy the rest of the source code files.",
        "SINGLECOPY"
      )
    );

  return problems;
}

function checkVersionPinning(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const froms = dockerfile.getFROMs();

  froms.forEach((from) => {
    const tag = from.getImageTag();

    if (tag === null)
      problems.push(
        createRepairDiagnostic(
          from.getRange(),
          "The version of the base image should be pinned to improve stability, speed and security.",
          "NOIMAGEPIN"
        )
      );
  });

  return problems;
}

function checkApkProblems(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const apkInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "RUN")
    .filter(
      (instruction) =>
        instruction
          .getArguments()
          .map((arg) => arg.getValue())
          .find((argValue) => argValue === "apk") !== undefined
    );

  apkInstructions.forEach((instruction) => {
    const args = instruction.getArguments();

    const apkArg = args.find((arg) => arg.getValue() === "apk");
    const addArg = args.find((arg) => arg.getValue() === "add");

    if (addArg === undefined) return;

    const hasCacheArg =
      args.find((arg) => arg.getValue() === "--no-cache") !== undefined;

    const range = {
      start: apkArg.getRange().start,
      end: addArg.getRange().end,
    };

    if (!hasCacheArg)
      problems.push(
        createRepairDiagnostic(
          range,
          "The --no-cache option should be used when installing packages with APK.",
          "NOCACHE"
        )
      );
  });

  return problems;
}

function checkNetworkUtils(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const runInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "RUN");

  const curlInstructions = [];

  runInstructions
    .filter(
      (instruction) =>
        instruction
          .getArguments()
          .map((arg) => arg.getValue())
          .find((argValue) => argValue === "curl") !== undefined
    )
    .forEach((instruction) => {
      const instructionComponents = [instruction.getKeyword()].concat(
        instruction.getArguments().map((arg) => arg.getValue())
      );
      for (let i = 1; i < instructionComponents.length; i++) {
        const component = instructionComponents[i];
        const previousComponent = instructionComponents[i - 1];

        const currentComponentIsCurl = component === "curl";
        const previousComponentIsAnd = previousComponent === "&&";
        const previousComponentIsRun = previousComponent === "RUN";
        const currentComponentIsNotArgOfAnotherCommand =
          previousComponentIsAnd || previousComponentIsRun;

        if (currentComponentIsCurl && !currentComponentIsNotArgOfAnotherCommand)
          return;
      }
      curlInstructions.push(instruction);
    });

  const wgetInstructions = runInstructions.filter(
    (instruction) =>
      instruction
        .getArguments()
        .map((arg) => arg.getValue())
        .find((argValue) => argValue === "wget") !== undefined
  );

  curlInstructions.forEach((instruction) => {
    const args = instruction.getArguments();

    const curlArg = args.find((arg) => arg.getValue() === "curl");

    if (curlArg === undefined) return;

    const hasQuietFlag =
      args.find((arg) => arg.getValue() === "-f") !== undefined;

    if (!hasQuietFlag)
      problems.push(
        createRepairDiagnostic(
          curlArg.getRange(),
          "The -f option should be used with curl to avoid errors if the request fails.",
          "FCURL"
        )
      );
  });

  wgetInstructions.concat(curlInstructions).forEach((instruction) => {
    const args = instruction.getArguments();

    const urlArg = args.find((arg) => arg.getValue().includes("http"));

    if (urlArg === undefined) return;

    const isHttps = urlArg.getValue().includes("https");

    if (!isHttps)
      problems.push(
        createRepairDiagnostic(
          urlArg.getRange(),
          "HTTPS URLs should be used instead of HTTP URLs.",
          "NOHTTPURL"
        )
      );
  });

  return problems;
}

function checkCdUsage(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const runInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "RUN");

  runInstructions.forEach((instruction) => {
    const args = instruction.getArguments();
    const hasTwoArguments = args.length === 2;
    const cdArg = args.find((arg) => arg.getValue() === "cd");

    if (!hasTwoArguments || cdArg === undefined) return; //goes to next iteration

    const range = {
      start: instruction.getRange().start,
      end: args[0].getRange().end,
    };

    problems.push(
      createRepairDiagnostic(
        range,
        "The working directory is not preserved between RUN instruction. Use the WORKDIR instruction instead.",
        "NOCD"
      )
    );
  });

  return problems;
}

function checkUnsuitableInstructions(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const instructions = dockerfile.getInstructions();

  const addInstructions = instructions.filter(
    (instruction) => instruction.getKeyword() === "ADD"
  );
  const maintainerInstructions = instructions.filter(
    (instruction) => instruction.getKeyword() === "MAINTAINER"
  );

  addInstructions.forEach((instruction) => {
    const instructionRangeStart = instruction.getRange().start;
    const range = {
      start: instructionRangeStart,
      end: {
        line: instructionRangeStart.line,
        character: instructionRangeStart.character + 3,
      },
    };
    problems.push(
      createRepairDiagnostic(
        range,
        "The COPY instruction should be used instead of the ADD instruction, if possible.",
        "NOADD"
      )
    );
  });

  maintainerInstructions.forEach((instruction) => {
    problems.push(
      createRepairDiagnostic(
        instruction.getRange(),
        "The MAINTAINER instruction has been deprecated.",
        "NOMAINTAINER"
      )
    );
  });

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

      problems.push(
        createRepairDiagnostic(
          range,
          "Consecutive RUN instructions should be merged to minimize the number of layers.",
          "CONSECUTIVERUN"
        )
      );
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
    const aptGetArg = args.find(
      (arg, index) =>
        arg.getValue() === "apt-get" && args[index + 1].getValue() === "install"
    );
    const installArg = args.find((arg) => arg.getValue() === "install");

    if (installArg === undefined) return; //goes to next iteration

    const missingElementProblems = checkMissingElements(
      aptGetArg,
      installArg,
      args
    );
    if (missingElementProblems.length > 0)
      problems.push(...missingElementProblems);

    const missingAptListRemoval = checkAtpListRemoval(instruction);
    if (missingAptListRemoval !== undefined)
      problems.push(missingAptListRemoval);
  });

  return problems;
}

function checkAtpListRemoval(instruction: Instruction): Diagnostic | undefined {
  const args = instruction.getArguments();

  const argString = args
    .map((arg) => arg.getValue())
    .join(" ")
    .replace("  ", " ");

  if (argString.includes("rm -rf /var/lib/apt/lists/*")) return;

  return createRepairDiagnostic(
    instruction.getRange(),
    "The list of packages should be removed after performing an installation to reduce wasted space.",
    "APTLIST"
  );
}

function checkMissingElements(
  aptGetArg: Argument,
  installArg: Argument,
  args: Argument[]
): Diagnostic[] {
  const problems: Diagnostic[] = [];

  if (aptGetArg === undefined) return [];

  const range: Range = {
    start: aptGetArg.getRange().start,
    end: installArg.getRange().end,
  };

  if (
    args.find((arg) => arg.getValue() === "--no-install-recommends") ===
    undefined
  )
    problems.push(
      createRepairDiagnostic(
        range,
        "The --no-install-recommends option should be used with apt-get install.",
        "NOINSTALLRECOMMENDS"
      )
    );

  if (
    args.find((arg) => arg.getValue() === "update") === undefined &&
    args.find((arg) => arg.getValue() === "-y") !== undefined
  )
    problems.push(
      createRepairDiagnostic(
        range,
        "The apt-get update command should be executed before apt-get install.",
        "UPDATEBEFOREINSTALL"
      )
    );

  if (args.find((arg) => arg.getValue() === "-y") === undefined)
    problems.push(
      createRepairDiagnostic(
        range,
        "The -y option should be used with apt-get install.",
        "CONFIRMINSTALL"
      )
    );

  return problems;
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
