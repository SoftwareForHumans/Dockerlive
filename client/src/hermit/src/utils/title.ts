import chalk from 'chalk';
import figlet from 'figlet';


export const renderTitle = () => {
  console.log(
    chalk.red(
      figlet.textSync('hermit', { horizontalLayout: 'full' })
    )
  );
}