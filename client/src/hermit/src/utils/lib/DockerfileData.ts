import DependenciesData from './DependenciesData';

export default interface DockerfileData {
  images: Array<string>,
  systemPackages: DependenciesData,
  dependencies: Array<string>,
  ports: Array<number>,
  entrypoint: Array<string>,
  envVars: Array<string>,
  filesIgnored: Array<string>
}