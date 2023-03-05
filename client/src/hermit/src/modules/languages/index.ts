let langModule: any = null;

import logger from '../../utils/logger';

const languages: Record<string, string> = {
  go: 'golang',
  java: 'java',
  js: 'javascript',
  py: 'python',
  web: 'web'
};

const languageModule = async (extension: string) => {
  if (langModule == null) {
    const modulePath: string = './' + languages[extension];

    try {
      langModule = await import(modulePath);
    }
    catch (e) {
      logger.error(`Hermit lacks support for language of extension ${extension}`);
    }
  }

  return langModule;
}

export default languageModule;