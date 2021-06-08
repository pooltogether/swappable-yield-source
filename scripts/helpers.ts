import chalk from 'chalk';

const displayLogs = !process.env.HIDE_DEPLOY_LOG;

export const action = (message: string) => {
  if (displayLogs) {
    console.log(chalk.cyan(message));
  }
};

export const alert = (message: string) => {
  if (displayLogs) {
    console.log(chalk.yellow(message));
  }
};

export const info = (message: string) => {
  if (displayLogs) {
    console.log(chalk.dim(message));
  }
};

export const success = (message: string) => {
  if (displayLogs) {
    console.log(chalk.green(message));
  }
};
