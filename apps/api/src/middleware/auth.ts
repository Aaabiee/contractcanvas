import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { $Enums } from '@prisma/client';

const ISSUER    = process.env.AUTH_ISSUER?.replace(/\/+$/, '');
const AUDIENCE  = process.env.AUTH_AUDIENCE;
const JWKS_URI  = process.env.AUTH_JWKS_URI || (ISSUER ? `${ISSUER}/.well-known/jwks.json` : undefined);
const HS_SECRET = process.env.JWT_SECRET;
const ROLE_CLAIM = process.env.AUTH_ROLE_CLAIM;

export interface OrgMembership {
  id:   string;
  name: string;
  slug: string;
  role: string;
}

export interface UserClaims {
  id:             string;
  sub?:           string;
  email?:         string;
  name?:          string | null;
  picture?:       string;
  roles:          string[];
  role?:          $Enums.Role;
  orgRoles?:      $Enums.OrgRole[];
  orgRole?:       $Enums.OrgRole;
  organizations?: OrgMembership[];
  organizationId?: string;
  [k: string]: any;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined = undefined;
if (JWKS_URI) {
  try {
    jwks = createRemoteJWKSet(new URL(JWKS_URI), { timeoutDuration: 5_000 });
    console.log(`[auth] Using remote JWKS: ${JWKS_URI}`);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[auth] Failed to initialize JWKS from ${JWKS_URI}:`, message);
  }
}

async function verifyToken(token: string): Promise<JWTPayload> {
  const opts = { issuer: ISSUER, audience: AUDIENCE };

  if (jwks) {
    const { payload } = await jwtVerify(token, jwks, { ...opts, algorithms: ['RS256'] });
    return payload;
  }

  if (HS_SECRET) {
    const key = new TextEncoder().encode(HS_SECRET);
    const { payload } = await jwtVerify(token, key, { ...opts, algorithms: ['HS256'] });
    return payload;
  }

  throw new Error('No verifier configured (set AUTH_ISSUER/AUTH_JWKS_URI or JWT_SECRET).');
}

function toUser(payload: JWTPayload): UserClaims {
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined;

  const email =
    typeof payload.email === 'string'
      ? payload.email
      : Array.isArray((payload as any).emails) && typeof (payload as any).emails[0] === 'string'
      ? (payload as any).emails[0]
      : undefined;

  const toStrArray = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    return [];
  };
  const dedupe = <T,>(arr: T[]) => Array.from(new Set(arr));

  const roleClaimKey = ROLE_CLAIM || 'roles';
  let roleStrings: string[] =
    toStrArray((payload as any)[roleClaimKey]) ||
    toStrArray((payload as any).permissions)   ||
    toStrArray((payload as any).authorities)   ||
    toStrArray((payload as any).role)          ||
    toStrArray((payload as any).scope);

  if (!roleStrings.length) {
    for (const [k, v] of Object.entries(payload)) {
      if (/roles?$/i.test(k)) {
        roleStrings = toStrArray(v);
        if (roleStrings.length) break;
      }
    }
  }
  roleStrings = dedupe(roleStrings);

  let orgRoleStrings: string[] =
    toStrArray((payload as any).org_roles)          ||
    toStrArray((payload as any).organization_roles) ||
    toStrArray((payload as any).tenant_roles)       ||
    toStrArray((payload as any).orgRole)            ||
    toStrArray((payload as any).organization_role)  ||
    toStrArray((payload as any).tenant_role);
  orgRoleStrings = dedupe(orgRoleStrings);

  const ROLE_MAP: Record<string, $Enums.Role> = {
    admin:       'ADMIN',
    lawyer:      'LAWYER',
    attorney:    'LAWYER',
    paralegal:   'PARALEGAL',
    'para-legal':'PARALEGAL',
    client:      'CLIENT',
    customer:    'CLIENT',
  };
  const ORG_ROLE_MAP: Record<string, $Enums.OrgRole> = {
    owner:  'OWNER',
    admin:  'ADMIN',
    member: 'MEMBER',
  };

  const asRoleEnum    = (s: string): $Enums.Role    | undefined => ROLE_MAP[s.toLowerCase()];
  const asOrgRoleEnum = (s: string): $Enums.OrgRole | undefined => ORG_ROLE_MAP[s.toLowerCase()];

  const roleEnum     = roleStrings.map(asRoleEnum).find((v): v is $Enums.Role => Boolean(v));
  const orgRolesEnum = orgRoleStrings.map(asOrgRoleEnum).filter((v): v is $Enums.OrgRole => Boolean(v));
  const orgRoleEnum  = orgRolesEnum[0];

  const organizations: OrgMembership[] | undefined = Array.isArray((payload as any).organizations)
    ? (payload as any).organizations
    : undefined;

  return {
    id:      sub || String((payload as any).user_id || (payload as any).uid || ''),
    sub,
    email,
    name:    typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    roles:   roleStrings,
    ...(roleEnum           ? { role: roleEnum }                    : {}),
    ...(orgRolesEnum.length ? { orgRoles: dedupe(orgRolesEnum) }   : {}),
    ...(orgRoleEnum        ? { orgRole: orgRoleEnum }              : {}),
    ...(organizations      ? { organizations }                     : {}),
  };
}

function resolveOrganizationId(req: Request, user: UserClaims): string | undefined {
  const orgs = user.organizations;
  if (!orgs?.length) return undefined;

  const header = req.header('X-Organization-Id');
  if (header) {
    const match = orgs.find(o => o.id === header);
    if (match) return match.id;
    // Header provided but doesn't match any of the user's orgs — deny in protect()
    return undefined;
  }

  return orgs[0].id;
}

function getBearer(req: Request): string | null {
  const h = req.header('Authorization');
  if (!h || typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function protect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getBearer(req);
    if (!token) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing Bearer token' });
      return;
    }

    const payload = await verifyToken(token);
    const user    = toUser(payload);

    if (!user.id) {
      res.status(401).json({ error: 'unauthorized', message: 'Invalid token (no subject)' });
      return;
    }

    user.organizationId = resolveOrganizationId(req, user);

    req.user = user;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid or expired token';
    console.warn('[auth] verify failed:', message);
    res.status(401).json({ error: 'unauthorized', message });
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = getBearer(req);
  if (!token) { next(); return; }

  try {
    const payload = await verifyToken(token);
    const user    = toUser(payload);
    user.organizationId = resolveOrganizationId(req, user);
    req.user = user;
  } catch {
  }
  next();
}

export function requireRole(...roles: string[]): RequestHandler {
  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const userRoles = user.roles || [];
    if (!roles.some(r => userRoles.includes(r))) {
      res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });
      return;
    }
    next();
  };
}

export default protect;
