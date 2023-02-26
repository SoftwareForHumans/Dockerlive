import { Argument, Dockerfile, Instruction } from "dockerfile-ast";
import {
  Diagnostic,
  Range,
  Position,
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
