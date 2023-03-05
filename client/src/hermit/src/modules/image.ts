import SourceInfo from '../utils/lib/SourceInfo';
import SystemInfo from '../utils/lib/SystemInfo';
import HermitOptions from '../utils/lib/HermitOptions'

const imageModule = (_inspectedData: SourceInfo, _tracedData: SystemInfo, languageData: any, options: HermitOptions): Array<string> => (
  options.multiStage ? languageData.languageImages : [languageData.languageImages[0]]
);

export default imageModule;