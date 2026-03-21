import { Router } from 'express';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../prisma.js';
import { app as appCfg, s3 } from '../config.js';
import { getRedisClient } from '../lib/redis.js';

const router = Router();

router.get('/', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let allOk = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks['db'] = 'ok';
  } catch {
    checks['db'] = 'error';
    allOk = false;
  }

  try {
    const s3Client = new S3Client({
      region:         s3.region,
      endpoint:       s3.endpoint,
      forcePathStyle: true,
      credentials:    { accessKeyId: s3.accessKey ?? '', secretAccessKey: s3.secretKey ?? '' },
    });
    await s3Client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
    checks['s3'] = 'ok';
  } catch {
    checks['s3'] = 'error';
    allOk = false;
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
      allOk = false;
    }
  }

  res.status(allOk ? 200 : 503).json({ ok: allOk, env: appCfg.env, checks });
});

export default router;
