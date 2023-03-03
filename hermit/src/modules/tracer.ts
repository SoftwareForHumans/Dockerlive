import { ChildProcess, exec } from 'child_process';
import path from 'path'
import { buildImage, createContainer, removeImage, extractPorts } from '../utils/containers';

import { TEMP_DIR, SYSCALL_LOGS, readSyscallLogs, createTemporaryDir, readDockerfile, writeDockerfileStrace } from '../utils/fileSystem';
import { parseLine } from '../utils/parser';
import logger from '../utils/logger';
import Syscall from '../utils/lib/Syscall';
import SystemInfo from '../utils/lib/SystemInfo';
import HermitOptions from '../utils/lib/HermitOptions';

const PROGRAMS_BLACKLIST: Array<string> = ["google-chrome-stable"];

const isBlacklisted = (program: string) => {
  for (const p in PROGRAMS_BLACKLIST) {
    if (program.includes(p)) return true
  };

  return false;
}

const parseProcLogs = (options: HermitOptions): SystemInfo => {
  const systemInfo: SystemInfo = {
    openat: new Array<Syscall>(),
    bind: new Array<Syscall>(),
    execve: new Array<Syscall>()
  }

  const logs: string = readSyscallLogs(options.container);
  const pids: Array<number> = new Array<number>();
  const pidBlacklist: Array<number> = new Array<number>();

  logs.split('\n').forEach((line: string) => {

    const syscall: Syscall | null = parseLine(line);

    if (syscall == null) return;

    const syscallName: string = syscall.syscall;

    if (!pids.includes(syscall.pid)) pids.push(syscall.pid);

    if (pidBlacklist.includes(syscall.pid)) return;

    switch (syscallName) {
      case 'open':
      case 'openat':
        systemInfo.openat.push(syscall);
        break;
      case 'bind':
        systemInfo.bind.push(syscall);
        break;
      case 'execve':
        if (syscall.result != 0) return;

        const programName = syscall.args[0];

        if (programName == undefined || Number.isInteger(programName)) return;

        if (isBlacklisted(programName)) {
          pidBlacklist.push(syscall.pid);
          return;
        }

        systemInfo.execve.push(syscall);
        break;
      default:
        break;
    }
  });

  if (!options.container) {
    pids.forEach((pid) => {
      try {
        process.kill(pid);
      }
      catch (e) { }
    });
  }

  return systemInfo;
}

const traceSystemCalls = (command: string, options: HermitOptions) => new Promise<SystemInfo>((resolve: Function, reject: Function) => {
  const PROC_TIMEOUT: number = options.timeout * 1000;

  createTemporaryDir();

  const tracerProcess: ChildProcess = exec(
    `strace -o ${TEMP_DIR}/${SYSCALL_LOGS} -v -s 200 -f -e trace=execve,network,openat ${command}`,
    { timeout: PROC_TIMEOUT }
  );

  tracerProcess.on('exit', (code) => {
    if (code == null) {
      logger.info(`Process terminated after ${PROC_TIMEOUT} miliseconds have passed`);
    }
    else {
      logger.info(`Process finished with code ${code}`);
    }

    resolve(parseProcLogs(options));
  });

  tracerProcess.on('error', (error) => {
    reject(error);
  });
})

const injectStraceContainer = (options: HermitOptions) => {
  const dockerfilePath = path.join(options.path, 'Dockerfile');
  const dockerfileLines = readDockerfile(dockerfilePath);

  const ports: Array<string> = new Array<string>();

  let image: string = "";
  let workdir: string = "";
  let workdirIndex: number = -1;
  let cmdIndex: number = -1;
  let fromIndex: number = -1;

  for (let i = 0; i < dockerfileLines.length; i++) {
    let line = dockerfileLines[i];

    if (line.includes("FROM")) {
      image = line.replace("FROM", "").trim();
      fromIndex = i;
    }

    if (line.includes("WORKDIR")) {
      workdir = line.replace("WORKDIR", "").trim();
      workdirIndex = i;
    }

    if (line.includes("EXPOSE")) {
      ports.concat(line.replace("EXPOSE", "").trim().split(" "));
    }

    if ((line.includes("CMD") || line.includes("ENTRYPOINT")) && (cmdIndex == -1)) {
      cmdIndex = i;
      const cmdRegex = RegExp('\\[.*?\\]').exec(line);
      const lineWords = line.split(" ");
      //if (cmdRegex == null) throw new Error('Dockerfile has no entrypoint');

      const parsedCmd = (cmdRegex == null) ? lineWords.slice(1) : JSON.parse(cmdRegex[0]);
      const newEntrypoint = ['strace', '-o', `${SYSCALL_LOGS}`, '-v', '-s 200', '-f', '-e', 'trace=execve,network,open,openat']
        .concat(parsedCmd);

      dockerfileLines[cmdIndex] = `${lineWords[0]} ${JSON.stringify(newEntrypoint)}`;
    }

    if (line.includes("USER")) {
      dockerfileLines[i] = `#${dockerfileLines[i]}`;
    }
  };

  const installCmd: string = `RUN ${image.includes("alpine") ?
    "apk update && apk add --no-cache" :
    "apt update && apt install -y"} strace`;

  dockerfileLines.splice(cmdIndex - 1, 0, installCmd);

  if (workdir == '/') {
    workdir = "/strace-app";
    dockerfileLines[workdirIndex] = `WORKDIR ${workdir}`;
  }
  else if (workdir == "") {
    workdir = "/strace-app";
    dockerfileLines.splice(fromIndex + 1, 0, `WORKDIR ${workdir}`);
  }

  writeDockerfileStrace(dockerfileLines.join('\n'));

  return workdir;
}

const traceContainerSyscalls = async (workdir: string, cmd: string, options: HermitOptions) => {
  logger.info("Building image");
  const imageId = await buildImage(options);

  logger.info(`Creating container from image with ID ${imageId}`);
  const container = await createContainer(imageId, cmd, options, workdir);

  logger.info(`Starting container from image with ID ${imageId}`);
  await container.start();

  // Extract Container Ports
  const ports = await extractPorts(container);

  logger.info("Running service");
  await new Promise((resolve) => setTimeout(resolve, options.timeout * 1000));

  logger.info("Stoping and removing container");
  await container.remove({ force: true });

  logger.info("Stoping and removing image");
  try {
    await removeImage(imageId);
  }
  catch { }

  logger.info("Finished Docker Analysis");
  const sysInfo = parseProcLogs(options);
  sysInfo.bind = sysInfo.bind.concat(ports);

  return sysInfo;
}

const tracerModule = async (command: string, options: HermitOptions) => {
  if (options.container) {
    logger.info("Creating Dockerfile.strace");
    const workdir = injectStraceContainer(options);
    const syscalls: SystemInfo = await traceContainerSyscalls(workdir, command, options);

    logger.info("Finished Tracing");
    return syscalls;
  }

  const syscalls: SystemInfo = await traceSystemCalls(command, options);

  return syscalls;
}

export default tracerModule;