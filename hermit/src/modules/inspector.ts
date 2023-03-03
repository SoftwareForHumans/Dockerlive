import fs from 'fs';
import path from 'path'

import SourceInfo from '../utils/lib/SourceInfo';
import logger from '../utils/logger';

const SUPPORTED_LANGUAGES: Array<string> = ['js', 'go', 'py', 'java', 'html', 'css'];
const INGORED_FOLDERS: Array<string> = ['node_modules'];

const updateCount = (file: string, info: any) => {
  const extension: string = file.split('.').pop() || 'null';
  if (SUPPORTED_LANGUAGES.includes(extension)) {
    info.files++;

    if (info.langs.hasOwnProperty(extension)) {
      info.langs[extension]++;
    }
    else {
      info.langs[extension] = 1;
    }
  }
}

const detectLanguage = (info: any) => {
  if ((info.langs.html || 0) > 0) info.web = true;

  const keys = Object.keys(info.langs);
  keys.sort((a: string, b: string) => {
    if (info.langs[a] < info.langs[b]) {
      return 1;
    }
    else if (info.langs[a] > info.langs[b]) {
      return -1;
    }
    return 0;
  });

  let languageIndex = 0;

  while (['html', 'css'].includes(keys[languageIndex])) {
    languageIndex++;
  }

  info.language = keys[languageIndex];
}

const inspectorModule = async () => {
  const currDir: string = '.';
  const dirs: Array<string> = [currDir];

  let sourceInfo: SourceInfo = {
    files: 0,
    language: 'null',
    web: false,
    scripts: {},
    langs: {}
  };

  try {
    for (let i = 0; i < dirs.length; i++) {
      // Current dir
      const dir = dirs[i];

      // Get the files as an array
      const files = await fs.promises.readdir(dir);

      // Loop them all with the new for...of
      for (const file of files) {
        // Get the full paths
        const filePath = path.join(dir, file);

        // Stat the file to see if we have a file or dir
        const stat = await fs.promises.stat(filePath);

        if (stat.isFile()) {
          // It's a file
          updateCount(file, sourceInfo);
        }
        else if (stat.isDirectory()) {
          // It's a directory
          if (!INGORED_FOLDERS.includes(file)) {
            dirs.push(filePath);
          }
        }
      }
    }
  }
  catch (e) {
    logger.error(e);
  }

  detectLanguage(sourceInfo);
  console.log(sourceInfo);

  return sourceInfo;
}

export default inspectorModule;