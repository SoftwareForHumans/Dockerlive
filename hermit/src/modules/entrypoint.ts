import SourceInfo from '../utils/lib/SourceInfo';
import SystemInfo from '../utils/lib/SystemInfo';
import Syscall from '../utils/lib/Syscall';
import HermitOptions from '../utils/lib/HermitOptions'

const EXECUTABLES_EXTENSIONS = ['sh'];

const includesLanguageRuntime = (argsArray: Array<string>, languageRuntimes: Array<string>) => {

  for (let index in languageRuntimes) {
    if (argsArray.includes(languageRuntimes[index])) {
      return true;
    }
  }

  return false;
}

const entrypointModule = (inspectedData: SourceInfo, tracedData: SystemInfo, languageData: any, options: HermitOptions): Array<string> => {
  let entrypointData: Array<string> = new Array<string>();

  if (inspectedData.scripts.start != undefined && !options.multiStage) {
    entrypointData = inspectedData.scripts.start.split(" ");

    return entrypointData;
  }

  const syscalls: Array<Syscall> = tracedData.execve;
  const languageRuntime: Array<string> = languageData.languageRuntime;
  const currentPath: string = options.path;
  const firstExec = syscalls[0].args[1];

  if (EXECUTABLES_EXTENSIONS.includes(firstExec[0].split('.')[1])) {
    return firstExec;
  }

  for (let index in syscalls) {
    const call = syscalls[index];
    const argsArray: Array<any> = call.args[1];
    const result: any = call.result;

    if (result == 0 && includesLanguageRuntime(argsArray, languageRuntime)) {
      // The non-minimalist images require the exectuble to the entrypoint
      if (options.multiStage) {
        argsArray.shift();
      }

      if (currentPath != undefined) {
        for (let i = 0; i < argsArray.length; i++) {
          let arg: string = argsArray[i];

          if (arg.includes(currentPath)) {
            argsArray[i] = `.${arg.replace(currentPath, "")}`;
          }
        };
      }

      entrypointData = argsArray;
      break;
    }
  };

  if (entrypointData.length === 0) {
    return firstExec;
  }

  return entrypointData;
}

export default entrypointModule;