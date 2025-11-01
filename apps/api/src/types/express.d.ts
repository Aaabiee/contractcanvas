// apps/api/src/types/express.d.ts
import type { UserClaims } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      user?: UserClaims;

      // Multer adds these:
      file?: Express.Multer.File;
      files?:
        | Express.Multer.File[]
        | { [fieldname: string]: Express.Multer.File[] };
    }
  }
}
export {};