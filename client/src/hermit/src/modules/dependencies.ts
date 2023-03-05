import { execSync } from 'child_process';

import SourceInfo from '../utils/lib/SourceInfo';
import SystemInfo from '../utils/lib/SystemInfo';
import Syscall from '../utils/lib/Syscall';
import DependenciesData from '../utils/lib/DependenciesData';
import HermitOptions from '../utils/lib/HermitOptions'

import { readDebianPackages, readLanguagePackages } from '../utils/fileSystem';
import logger from '../utils/logger';

const getPackageName = (library: string) => {
  try {
    const packageName: string = execSync(`dpkg -S ${library}`, { stdio: 'pipe', encoding: 'utf-8' }).split(':')[0];

    return packageName;
  }
  catch (e) { }

  try {
    const packageName: string = execSync(`dpkg -S "$(readlink -f ${library})"`, { stdio: 'pipe', encoding: 'utf-8' }).split(':')[0];

    return packageName;
  }
  catch (e2) { }

  return null;
}

const isLibrary = (fileName: string) => {
  if ((typeof fileName) !== "string") {
    return false;
  }
  return fileName.split('.').includes('so') && !fileName.includes('python');
}

const filterPackages = (packagesList: Array<string>, pathsList: Array<string>, languageData: any): DependenciesData => {
  const { languagePackages } = languageData;

  const installablePackages: Array<string> = new Array<string>();
  const filteredPackages: Array<string> = new Array<string>();
  const librariesPath: Array<string> = new Array<string>();

  const debianPackages: Array<string> = readDebianPackages();
  const languagepackages: Array<string> = readLanguagePackages(languageData.PACKAGES_LIST);

  let packagesCount: number = packagesList.length;

  for (let i = 0; i < debianPackages.length; i++) {
    const debianPackage = debianPackages[i];

    const index = packagesList.indexOf(debianPackage);

    if (index > -1) {
      installablePackages.push(debianPackage);

      librariesPath.push(`/usr${pathsList[index]}`);

      packagesCount--;
      if (packagesCount == 0) break;
    }
  }

  installablePackages.forEach((dep) => {
    if (!languagepackages.includes(dep)) {
      filteredPackages.push(dep);
    }
  });

  return {
    packages: filteredPackages.concat(languagePackages),
    libraries: librariesPath
  };
}

const dependenciesModule = (_inspectedData: SourceInfo, tracedData: SystemInfo, languageData: any, _options: HermitOptions) => {
  const syscalls: Array<Syscall> = tracedData.openat;
  const installationSteps: Array<string> = languageData.languageDependenciesInstallation;

  const analyzedDependencies: Array<string> = new Array<string>()
  const languageDependencies: Array<string> = new Array<string>()
  const systemDependencies: Array<string> = new Array<string>()
  const pathsList: Array<string> = new Array<string>()

  syscalls.forEach((call) => {
    const fileName: string = (call.syscall === "openat") ? call.args[1] : call.args[0];

    if (analyzedDependencies.includes(fileName)) return;

    if (isLibrary(fileName)) {
      const packageName: string | null = getPackageName(fileName);

      if (packageName != null && !systemDependencies.includes(packageName)) {
        systemDependencies.push(packageName);
        pathsList.push(fileName);
        logger.info(`Package ${packageName} detected`);
      }
    }
    else {
      languageDependencies.push(fileName);
    }

    analyzedDependencies.push(fileName);
  });

  return {
    languagueDependencies: installationSteps,
    systemDependencies: filterPackages(systemDependencies, pathsList, languageData)
  }
}

export default dependenciesModule;