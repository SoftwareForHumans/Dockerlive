export default interface SourceInfo {
  files: number,
  language: string,
  web: boolean,
  scripts: Record<string, string>,
  langs: Record<string, string>
};