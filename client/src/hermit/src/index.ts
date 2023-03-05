import tracerModule from './modules/tracer';
import inspectorModule from './modules/inspector';
import imageModule from './modules/image';
import dependenciesModule from './modules/dependencies';
import portsModule from './modules/ports';
import entrypointModule from './modules/entrypoint';
import generatorModule from './modules/generator';
import languageModule from './modules/languages'

import DockerfileData from './utils/lib/DockerfileData';
import HermitOptions from './utils/lib/HermitOptions';

// Default Options
export const defaultOptions: HermitOptions = {
  multiStage: false,
  timeout: 60,
  path: process.env.PWD || '.',
  container: false
};

export const dockerfileGeneration = async (command: string, suppliedOptions: any = {}) => {
  // Set the options
  const options: HermitOptions = {
    multiStage: suppliedOptions.multiStage || defaultOptions.multiStage,
    timeout: suppliedOptions.timeout || defaultOptions.timeout,
    path: suppliedOptions.path || defaultOptions.path,
    container: suppliedOptions.container || defaultOptions.container
  };

  // Modules to analyse software data
  const inspectedData = await inspectorModule();
  const tracedData = await tracerModule(command, options);

  // Load module with strategies more appropriated to the detected Programming Language
  const languageData = await languageModule(inspectedData.language);
  languageData.languageStaticInspection(inspectedData, options);

  // Modules to infer dockerfiles fields
  const imageData = imageModule(inspectedData, tracedData, languageData, options);
  const dependenciesData = dependenciesModule(inspectedData, tracedData, languageData, options);
  const portsData = portsModule(inspectedData, tracedData, languageData, options);
  const entrypointData = entrypointModule(inspectedData, tracedData, languageData, options);

  // Join Dockerfile Data
  const dockerfileData: DockerfileData = {
    images: imageData,
    systemPackages: dependenciesData.systemDependencies,
    dependencies: dependenciesData.languagueDependencies,
    ports: portsData,
    entrypoint: entrypointData,
    envVars: languageData.languageEnvVars,
    filesIgnored: languageData.filesIgnored
  }

  // Module to generate the dockerfile
  generatorModule(dockerfileData, options);

  return dockerfileData;
}