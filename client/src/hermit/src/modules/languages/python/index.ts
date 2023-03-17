import SourceInfo from '../../../utils/lib/SourceInfo';
import { existsRequirements, existsPipfile, readPipfile } from '../../../utils/fileSystem';

const LOCAL_SITE_PACKAGES = "local-site-packages";

export const languageImages = [
  "python:3.11-slim",
  "gcr.io/distroless/python3"
];

export const languageDependenciesInstallation = [
  "pip3 install --upgrade pip",
  `pip install -r ./requirements.txt --target ${LOCAL_SITE_PACKAGES}`
];

export const languageEnvVars = [
  `PYTHONPATH=./${LOCAL_SITE_PACKAGES}`
];

export const languageRuntime = ["python", "python3"];

export const PACKAGES_LIST: string = 'pythonpackages.txt';

export const filesIgnored = [
  "__pycache__"
];

export const languagePackages: Array<string> = [];

const buildPackages = ['python3-dev', 'build-essential', 'pkg-config', 'cmake'];

export const languageStaticInspection = (info: SourceInfo) => {
  if (existsRequirements()) {
    languagePackages.push(...buildPackages);
  }
  else if (existsPipfile()) {
    languageDependenciesInstallation.unshift("pip install pipenv && pipenv lock -r > requirements.txt");

    const pipfileContent: string = readPipfile();
    const regexMatch = pipfileContent.match(/python_version = "(.*?)"/);
    languageImages[0] = `python:${(regexMatch == null) ? "3.8" : regexMatch[1]}-slim`;

    languagePackages.push(...buildPackages);
  }
};