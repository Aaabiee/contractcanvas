import pino from 'pino';

const isDev  = process.env['NODE_ENV'] !== 'production';
const isTest = process.env['NODE_ENV'] === 'test';

export const logger = pino({
  level:     isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info')),
  transport: isDev && !isTest
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

export default logger;
