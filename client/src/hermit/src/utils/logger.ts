import winston from 'winston';

const myCustomLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  },
  colors: {
    error: 'bold white redBG',
    warn: 'bold white yellowBG',
    info: 'bold white blueBG',
    debug: 'bold white greyBG'
  },
};

// Instantiate new logger
const logger = winston.createLogger({
  levels: myCustomLevels.levels,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(info => `${info.level} ${info.message}`)
      )
    })
  ]
});

winston.addColors(myCustomLevels.colors);

export default logger;