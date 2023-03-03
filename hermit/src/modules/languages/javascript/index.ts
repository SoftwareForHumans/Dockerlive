import SourceInfo from '../../../utils/lib/SourceInfo';
import HermitOptions from '../../../utils/lib/HermitOptions';
import logger from '../../../utils/logger';

export const languageImages = [
  "node:14",
  "gcr.io/distroless/nodejs:14"
];

export const languageDependenciesInstallation = [
  "npm install --only=production"
];

export const languageEnvVars = [];

export const languageRuntime = ["node", "npm", "npx"];

export const PACKAGES_LIST: string = 'nodepackages.txt';

export const filesIgnored = [
  "node_modules"
];

export const languagePackages: Array<string> = [];

export const languageStaticInspection = (info: SourceInfo, options: HermitOptions) => {
  const path = options.path;

  try {
    const packageJson = require(`${path}/package.json`);
    const scripts = packageJson.scripts;

    if (scripts == undefined) return;

    for (let [key, _script] of Object.entries(scripts)) {
      info.scripts[key] = `npm ${key}`;
    }

  }
  catch (e) {
    logger.warn("package.json not found");
  }
};