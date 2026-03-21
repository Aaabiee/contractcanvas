import { Router, Request, Response } from 'express';
import { protect } from '../middleware/auth.js';
import { addClient, removeClient } from '../lib/sse-registry.js';

const router = Router();
export default router;

router.get('/stream', protect, (req: Request, res: Response) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user!.id;
  addClient(userId, res);

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(userId, res);
  });
});
