import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId?:      string;
  userId?:         string;
  organizationId?: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

const isDev  = process.env['NODE_ENV'] !== 'production';
const isTest = process.env['NODE_ENV'] === 'test';

function resolveTransport(): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
  if (isTest) return undefined;

  const transportName = process.env['LOG_TRANSPORT'];

  if (transportName === 'datadog') {
    return {
      target: 'pino-datadog-transport',
      options: {
        ddClientConf: { authMethods: { apiKeyAuth: process.env['DD_API_KEY'] } },
        ddtags: `env:${process.env['NODE_ENV'] ?? 'development'},service:contractcanvas-api`,
      },
    };
  }

  if (transportName === 'cloudwatch') {
    return {
      target: '@serdce/pino-cloudwatch-transport',
      options: {
        logGroupName: process.env['CW_LOG_GROUP'] ?? '/contractcanvas/api',
        logStreamName: process.env['CW_LOG_STREAM'] ?? process.env['HOSTNAME'] ?? 'default',
        awsRegion: process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1',
      },
    };
  }

  if (transportName === 'loki') {
    return {
      target: 'pino-loki',
      options: {
        host: process.env['LOKI_URL'] ?? 'http://localhost:3100',
        labels: { app: 'contractcanvas-api', env: process.env['NODE_ENV'] ?? 'development' },
        batching: true,
        interval: 5,
      },
    };
  }

  if (isDev) {
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };
  }

  return undefined;
}

export const logger = pino({
  level:     isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info')),
  transport: resolveTransport(),
  mixin() {
    const ctx = asyncLocalStorage.getStore();
    if (!ctx) return {};
    const mixin: Record<string, string> = {};
    if (ctx.requestId)      mixin.requestId      = ctx.requestId;
    if (ctx.userId)         mixin.userId          = ctx.userId;
    if (ctx.organizationId) mixin.organizationId  = ctx.organizationId;
    return mixin;
  },
});

export default logger;
