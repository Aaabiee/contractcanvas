import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export interface AppSection {
  env: string;
  port: number;
}
export interface DBConfig {
  user: string;
  password: string;
  name: string;
  port: number;
  container_name: string;
  host: string;
  schema: string;
}
export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle: boolean;
}
export interface StripeConfig {
  secretKey?: string;
  webhookSecret?: string;
}
export interface JwtConfig {
  secret: string;
}
export interface RawAppConfig {
  app?: Partial<AppSection>;
  db?: Partial<DBConfig>;
  s3?: Partial<S3Config>;
  stripe?: Partial<StripeConfig>;
  jwt?: Partial<JwtConfig>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const configPath = path.join(repoRoot, 'config.json');

const apiEnvPath = path.join(repoRoot, 'apps', 'api', '.env');
if (fs.existsSync(apiEnvPath)) {
  dotenv.config({ path: apiEnvPath });
}

let cfgFromFile: RawAppConfig = {};
try {
  if (fs.existsSync(configPath)) {
    cfgFromFile = JSON.parse(fs.readFileSync(configPath, 'utf8')) as RawAppConfig;
  } else {
    console.warn(`[Config] ${configPath} not found. Using defaults and environment variables.`);
  }
} catch (e: unknown) {
  const errorMessage = e instanceof Error ? e.message : String(e);
  console.error(`[Config] Failed to load or parse ${configPath}. Using defaults/env vars. Error: ${errorMessage}`);
}

const appCfgFromFile = cfgFromFile.app || {};
const dbCfgFromFile = cfgFromFile.db || {};
const s3CfgFromFile = cfgFromFile.s3 || {};
const stripeCfgFromFile = cfgFromFile.stripe || {};
const jwtCfgFromFile = cfgFromFile.jwt || {};

const env = process.env.NODE_ENV || appCfgFromFile.env || 'development';
const portString = process.env.PORT || (appCfgFromFile.port ? String(appCfgFromFile.port) : undefined) || '3333';
const port = parseInt(portString, 10);
export const app: AppSection = { env, port };

export const db: DBConfig = {
  user: process.env.POSTGRES_USER || dbCfgFromFile.user || 'postgres',
  password: process.env.POSTGRES_PASSWORD || dbCfgFromFile.password || 'postgres',
  name: process.env.POSTGRES_DB || dbCfgFromFile.name || 'contractcanvas_db',
  port: parseInt(process.env.POSTGRES_PORT || String(dbCfgFromFile.port ?? '5432'), 10),
  host:
    process.env.POSTGRES_HOST ||
    dbCfgFromFile.host ||
    (process.env.IS_DOCKER === 'true'
      ? dbCfgFromFile.container_name || 'db'
      : 'localhost'),
  schema: process.env.DB_SCHEMA || dbCfgFromFile.schema || 'public',
  container_name: dbCfgFromFile.container_name || 'contractcanvas-postgres',
};

const forcePathStyleRaw = (process.env.S3_FORCE_PATH_STYLE ??
  (typeof s3CfgFromFile.forcePathStyle === 'boolean' ? String(s3CfgFromFile.forcePathStyle) : 'true')) as
  | 'true'
  | 'false';

export const s3: S3Config = {
  endpoint: process.env.S3_ENDPOINT || s3CfgFromFile.endpoint,
  region: process.env.S3_REGION || s3CfgFromFile.region || 'us-east-1',
  bucket: process.env.S3_BUCKET || s3CfgFromFile.bucket || 'contractcanvas',
  accessKey: process.env.S3_ACCESS_KEY || s3CfgFromFile.accessKey,
  secretKey: process.env.S3_SECRET_KEY || s3CfgFromFile.secretKey,
  forcePathStyle: forcePathStyleRaw === 'true',
};

export const stripe: StripeConfig = {
  secretKey: process.env.STRIPE_SECRET_KEY || stripeCfgFromFile.secretKey,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || stripeCfgFromFile.webhookSecret,
};

const defaultJwtSecret = '!!CHANGE_ME_IN_CONFIG_OR_ENV!!';
const jwtSecretFromEnv = process.env.JWT_SECRET;
const jwtSecretFromFile = jwtCfgFromFile.secret;
let effectiveJwtSecret = jwtSecretFromEnv || jwtSecretFromFile || defaultJwtSecret;

if (app.env === 'production' && (!effectiveJwtSecret || effectiveJwtSecret === defaultJwtSecret)) {
  throw new Error('FATAL: JWT_SECRET must be set via environment variable or config.json for production!');
}
if (effectiveJwtSecret !== defaultJwtSecret && effectiveJwtSecret.length < 32) {
  const msg = 'JWT_SECRET must be at least 32 characters long (OWASP HMAC-SHA256 minimum).';
  if (app.env === 'production') throw new Error(`FATAL: ${msg}`);
  console.warn(`[Config] WARNING: ${msg}`);
}
if (app.env !== 'production' && effectiveJwtSecret === defaultJwtSecret) {
  console.warn('\n-------------------------------------------------------------------');
  console.warn('WARNING: Using insecure default JWT_SECRET. Set JWT_SECRET in .env or config.json.');
  console.warn('-------------------------------------------------------------------\n');
}
export const jwt: JwtConfig = { secret: effectiveJwtSecret };

export const DATABASE_URL =
  `postgresql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}` +
  `@${db.host}:${db.port}/${encodeURIComponent(db.name)}?schema=${db.schema}`;

const safeDbUrl = DATABASE_URL.replace(db.password, '****');
console.log(`[Config] Loaded for env: ${app.env}`);
console.log(`[Config] API Port: ${app.port}`);
console.log(`[Config] DB Connection (masked): ${safeDbUrl}`);
if (s3.endpoint) {
  console.log(`[Config] S3 Endpoint: ${s3.endpoint}, Bucket: ${s3.bucket}`);
}
if (stripe.secretKey && !stripe.secretKey.startsWith('CONTRA_') && stripe.secretKey.length > 8) {
  console.log(`[Config] Stripe Key: ${stripe.secretKey.substring(0, 8)}...`);
}
