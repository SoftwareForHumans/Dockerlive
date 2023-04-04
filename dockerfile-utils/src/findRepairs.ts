import {
  Argument,
  Dockerfile,
  DockerfileParser,
  Instruction,
} from "dockerfile-ast";
import { existsSync, readFileSync, unlinkSync } from "fs";
import {
  Diagnostic,
  Range,
  DiagnosticSeverity,
} from "vscode-languageserver-types";

let hermitDockerfileContent: string = null;

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

    if (range)
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

  if (
    hermitExposeInstructions.length > 0 &&
    originalExposeInstructions.length === 0
  ) {
    const range = getRangeBeforeEnd(dockerfile);
    if (!range) return null;

    return createRepairDiagnostic(
      range,
      "Some ports that could be exposed were detected.",
      "HERMITPORTS"
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
        "Some mistakes were detected with the ports being exposed.",
        "HERMITPORTS"
      );
  }

  return null;
}

function getRangeBeforeEnd(dockerfile: Dockerfile): Range | null {
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
      range &&
      hermitPkgInstructions.length > 0 &&
      originalPkgInstructions.length === 0
    ) {
      return createRepairDiagnostic(
        range,
        "Some dependencies that are missing from this Dockerfile have been detected.",
        "HERMITDEPS"
      );
    }
  }

  return null;
}

function getDistroUsed(dockerfile: Dockerfile): string {
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

function checkWorkDir(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const workdirInstructions = dockerfile
    .getInstructions()
    .filter((instruction) => instruction.getKeyword() === "WORKDIR");

  const range = getRangeAfterFrom(dockerfile);

  if (workdirInstructions.length === 0 && range)
    problems.push(
      createRepairDiagnostic(
        range,
        "A working directory other than / should be used.",
        "NOROOTDIR"
      )
    );

  return problems;
}

function getRangeAfterFrom(dockerfile: Dockerfile): Range | null {
  const froms = dockerfile.getFROMs();

  if (!froms || froms.length === 0) return null;

  const fromLine = froms[0].getRange().start.line;

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

    if (!args || args.length === 0) return;

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

        if (!component || !previousComponent) continue;

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

  curlInstructions.forEach((instruction: Instruction) => {
    const args = instruction.getArguments();

    if (!args || args.length === 0) return;

    let curlArgIndex = -1,
      quietFlagIndex = -1;

    args.forEach((arg, index) => {
      if (!arg) return;

      const argValue = arg.getValue();

      if (argValue === "curl") curlArgIndex = index;
      if (argValue === "-f") quietFlagIndex = index;
    });

    if (quietFlagIndex <= curlArgIndex) return;

    if (curlArgIndex === -1) return;

    const curlArg = args[curlArgIndex];

    const hasQuietFlag = quietFlagIndex !== -1;

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

    if (!args || args.length === 0) return;

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

    if (!args) return;

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

  if (!instructions || instructions.length === 0) return problems;

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
    const currentInstruction = instructions[i];
    const previousInstruction = instructions[i - 1];

    if (!currentInstruction || !previousInstruction) continue;

    const currentInstructionKeyword = currentInstruction.getKeyword();
    const previousInstructionKeyword = previousInstruction.getKeyword();

    const areConsecutiveRunInstructions =
      currentInstructionKeyword === previousInstructionKeyword &&
      currentInstructionKeyword == "RUN";

    if (areConsecutiveRunInstructions) {
      const range = {
        start: previousInstruction.getRange().start,
        end: currentInstruction.getRange().end,
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

  if (!aptInstructions || aptInstructions.length === 0) return [];

  aptInstructions.forEach((instruction) => {
    const args = instruction.getArguments();

    let aptGetArg: Argument = null;

    args.forEach((arg, index) => {
      const nextArg = args[index + 1];
      if (!nextArg) return;
      if (arg.getValue() === "apt-get" && nextArg.getValue() === "install")
        aptGetArg = arg;
    });

    const installArg = args.find((arg) => arg.getValue() === "install");

    if (installArg === undefined) return; //goes to next iteration

    const missingElementProblems = checkMissingElements(
      aptGetArg,
      installArg,
      args
    );
    if (missingElementProblems && missingElementProblems.length > 0)
      problems.push(...missingElementProblems);

    const missingAptListRemoval = checkAtpListRemoval(instruction);
    if (missingAptListRemoval) problems.push(missingAptListRemoval);
  });

  return problems;
}

function checkAtpListRemoval(instruction: Instruction): Diagnostic | null {
  const args = instruction.getArguments();

  if (!args || args.length === 0) return null;

  const argString = args
    .map((arg) => arg.getValue())
    .join(" ")
    .replace("  ", " ");

  if (argString.includes("rm -rf /var/lib/apt/lists/*")) return null;

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

  if (aptGetArg === undefined || !args) return [];

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
