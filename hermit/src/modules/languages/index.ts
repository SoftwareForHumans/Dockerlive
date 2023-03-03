let module: any = null;

import logger from '../../utils/logger';

const languages: Record<string, string> = {
  go: 'golang',
  java: 'java',
  js: 'javascript',
  py: 'python',
  web: 'web'
};

const languageModule = async (extension: string) => {
  if (module == null) {
    const modulePath: string = './' + languages[extension];

    try {
      module = await import(modulePath);
    }
    catch (e) {
      logger.error(`Hermit lacks support for language of extension ${extension}`);
    }
  }

  return module;
}

export default languageModule;