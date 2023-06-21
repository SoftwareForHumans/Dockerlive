import { Argument, Dockerfile, Instruction } from "dockerfile-ast";
import { Diagnostic, Range } from "vscode-languageserver-types";

import checkHermitAlternative from "./hermit";
import {
  createRepairDiagnostic,
  getInstructionsWithKeyword,
  getRangeAfterFrom,
  getRangeBeforeEnd,
  getRunInstructionsWithArg,
} from "./utils";

const NO_ROOT_USER_MSG =
  "A user other than root should be used. Running applications as root could lead to security problems if vulnerabilities in the project are exploited.";
const NO_ROOT_USER_SUFFIX = "NOROOTUSER";

const NO_ROOT_DIR_MSG =
  "A working directory other than / should be used. This makes the directory structure more organized and keeps other files separate from the application's code.";
const NO_ROOT_DIR_SUFFIX = "NOROOTDIR";

const SINGLE_COPY_MSG =
  "Two COPY instructions should be used, one to copy the files required for installing dependencies and another to copy the rest of the source code files. This way Docker's layer caching can be used.";
const SINGLE_COPY_SUFFIX = "SINGLECOPY";

const NO_IMAGE_PIN_MSG =
  "The version of the base image should be pinned to improve stability, speed and security.";
const NO_IMAGE_PIN_SUFFIX = "NOIMAGEPIN";

const NO_CACHE_MSG =
  "The --no-cache option should be used when installing packages with APK. This prevents APK from storing a cache, making the container smaller.";
const NO_CACHE_SUFFIX = "NOCACHE";

const F_CURL_MSG =
  "The -f option should be used with curl to avoid errors if the request fails.";
const F_CURL_SUFFIX = "FCURL";

const NO_HTTP_URL_MSG =
  "HTTPS URLs should be used instead of HTTP URLs. HTTPS provides encryption, making the connection more secure.";
const NO_HTTP_URL_SUFFIX = "NOHTTPURL";

const NO_CD_MSG =
  "The working directory is not preserved between RUN instruction. Use the WORKDIR instruction instead.";
const NO_CD_SUFFIX = "NOCD";

const NO_ADD_MSG =
  "The COPY instruction should be used instead of the ADD instruction, if possible. The ADD instruction has more features which can make its usage harder to understand.";
const NO_ADD_SUFFIX = "NOADD";

const NO_MAINTAINER_MSG = "The MAINTAINER instruction has been deprecated.";
const NO_MAINTAINER_SUFFIX = "NOMAINTAINER";

const CONSECUTIVE_RUN_MSG =
  "Consecutive RUN instructions should be merged to minimize the number of layers.";
const CONSECUTIVE_RUN_SUFFIX = "CONSECUTIVERUN";

const APT_LIST_MSG =
  "The list of packages should be removed after performing an installation to reduce wasted space.";
const APT_LIST_SUFFIX = "APTLIST";

const NO_INSTALL_RECOMMENDS_MSG =
  "The --no-install-recommends option should be used with apt-get install. This keeps recommended packages from being installed, reducing wasted space.";
const NO_INSTALL_RECOMMENDS_SUFFIX = "NOINSTALLRECOMMENDS";

const UPDATE_BEFORE_INSTALL_MSG =
  "The apt-get update command should be executed before apt-get install. This allows APT to update the list of packages.";
const UPDATE_BEFORE_INSTALL_SUFFIX = "UPDATEBEFOREINSTALL";

const CONFIRM_INSTALL_MSG =
  "The -y option should be used with apt-get install. This allows packages to be installed without prompting the user for confirmation.";
const CONFIRM_INSTALL_SUFFIX = "CONFIRMINSTALL";

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
  problems.push(
    ...checkForInstructionPresence(
      dockerfile,
      "WORKDIR",
      true,
      NO_ROOT_DIR_MSG,
      NO_ROOT_DIR_SUFFIX
    )
  );
  problems.push(
    ...checkForInstructionPresence(
      dockerfile,
      "USER",
      false,
      NO_ROOT_USER_MSG,
      NO_ROOT_USER_SUFFIX
    )
  );
  problems.push(...checkHermitAlternative(dockerfile));

  return problems;
}

function checkForInstructionPresence(
  dockerfile: Dockerfile,
  instructionName: string,
  rangeAtBeginning: boolean,
  message: string,
  suffix: string
): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const instructions = getInstructionsWithKeyword(dockerfile, instructionName);

  if (instructions.length === 0) {
    const range = rangeAtBeginning
      ? getRangeAfterFrom(dockerfile)
      : getRangeBeforeEnd(dockerfile);

    if (range) problems.push(createRepairDiagnostic(range, message, suffix));
  }

  return problems;
}

function checkCopys(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const copys = dockerfile.getCOPYs();

  const instructions = dockerfile.getInstructions();

  if (!instructions || instructions.length === 0) return problems;

  const lastInstruction = instructions[instructions.length - 1];

  if (lastInstruction.getKeyword() === "COPY") return problems;

  if (copys.length === 1)
    problems.push(
      createRepairDiagnostic(
        copys[0].getRange(),
        SINGLE_COPY_MSG,
        SINGLE_COPY_SUFFIX
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
          NO_IMAGE_PIN_MSG,
          NO_IMAGE_PIN_SUFFIX
        )
      );
  });

  return problems;
}

function checkApkProblems(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const apkInstructions = getRunInstructionsWithArg(dockerfile, "apk");

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
        createRepairDiagnostic(range, NO_CACHE_MSG, NO_CACHE_SUFFIX)
      );
  });

  return problems;
}

function checkNetworkUtils(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const curlInstructions = getRunInstructionsWithArg(dockerfile, "curl");

  const processedCurlInstructions = [];

  curlInstructions.forEach((instruction) => {
    const args = instruction
      .getArguments()
      .filter((arg) => arg.getValue() !== "\\");

    if (!args || args.length === 0) return;

    for (let i = 0; i < args.length; i++) {
      const currentArg = args[i];
      if (currentArg.getValue() !== "curl") continue;

      let range = null;

      if (i === 0) range = currentArg.getRange();
      else if (args[i - 1].getValue() === "&&") range = currentArg.getRange();

      if (range === null) continue;

      let urlArgIndex = -1;

      args.forEach((arg, index) => {
        if (arg.getValue().startsWith("http")) urlArgIndex = index;
      });

      if (urlArgIndex <= i) continue;

      processedCurlInstructions.push(instruction);

      const argsBetween = args
        .slice(i, urlArgIndex)
        .map((arg) => arg.getValue());

      if (!argsBetween.includes("-f"))
        problems.push(createRepairDiagnostic(range, F_CURL_MSG, F_CURL_SUFFIX));
    }
  });

  const wgetInstructions = getRunInstructionsWithArg(dockerfile, "wget");

  wgetInstructions.concat(processedCurlInstructions).forEach((instruction) => {
    const args = instruction.getArguments();

    if (!args || args.length === 0) return;

    const urlArg = args.find((arg) => arg.getValue().includes("http"));

    if (urlArg === undefined) return;

    const isHttps = urlArg.getValue().includes("https");

    if (!isHttps)
      problems.push(
        createRepairDiagnostic(
          urlArg.getRange(),
          NO_HTTP_URL_MSG,
          NO_HTTP_URL_SUFFIX
        )
      );
  });

  return problems;
}

function checkCdUsage(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const runInstructions = getInstructionsWithKeyword(dockerfile, "RUN");

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

    problems.push(createRepairDiagnostic(range, NO_CD_MSG, NO_CD_SUFFIX));
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
    problems.push(createRepairDiagnostic(range, NO_ADD_MSG, NO_ADD_SUFFIX));
  });

  maintainerInstructions.forEach((instruction) => {
    problems.push(
      createRepairDiagnostic(
        instruction.getRange(),
        NO_MAINTAINER_MSG,
        NO_MAINTAINER_SUFFIX
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
          CONSECUTIVE_RUN_MSG,
          CONSECUTIVE_RUN_SUFFIX
        )
      );
    }
  }

  return problems;
}

function checkAptProblems(dockerfile: Dockerfile): Diagnostic[] {
  const problems: Diagnostic[] = [];

  const aptInstructions = getRunInstructionsWithArg(dockerfile, "apt-get");

  if (!aptInstructions || aptInstructions.length === 0) return [];

  aptInstructions.forEach((instruction) => {
    const args = instruction.getArguments();

    let aptGetArg: Argument = null,
      installArg: Argument = null;

    args.forEach((arg, index) => {
      const nextArg = args[index + 1];
      if (!nextArg) return;
      if (arg.getValue() === "apt-get" && nextArg.getValue() === "install") {
        aptGetArg = arg;
        installArg = nextArg;
      }
    });

    if (!installArg) return; //goes to next iteration

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
    APT_LIST_MSG,
    APT_LIST_SUFFIX
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
        NO_INSTALL_RECOMMENDS_MSG,
        NO_INSTALL_RECOMMENDS_SUFFIX
      )
    );

  if (
    args.find((arg) => arg.getValue() === "update") === undefined &&
    args.find((arg) => arg.getValue() === "-y") !== undefined
  )
    problems.push(
      createRepairDiagnostic(
        range,
        UPDATE_BEFORE_INSTALL_MSG,
        UPDATE_BEFORE_INSTALL_SUFFIX
      )
    );

  if (args.find((arg) => arg.getValue() === "-y") === undefined)
    problems.push(
      createRepairDiagnostic(range, CONFIRM_INSTALL_MSG, CONFIRM_INSTALL_SUFFIX)
    );

  return problems;
}
