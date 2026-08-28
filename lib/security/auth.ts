import { SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const SESSION_COOKIE_NAME = 'admin_access_session';

function getSigningSecret(): Uint8Array {
  const key = process.env.ADMIN_ACCESS_KEY || 'moux_admin_default_internal_signing_key_32chars';
  return new TextEncoder().encode(key);
}

export function isRequestSecure(req?: NextRequest | Request): boolean {
  if (req) {
    const proto = req.headers.get('x-forwarded-proto');
    if (proto) {
      return proto.split(',')[0].trim().toLowerCase() === 'https';
    }
    if ('url' in req && req.url) {
      try {
        const parsed = new URL(req.url);
        return parsed.protocol === 'https:';
      } catch {
        // fallback
      }
    }
  }
  return process.env.NODE_ENV === 'production';
}

export function getCookieOptions(req?: NextRequest | Request) {
  const isSecure = isRequestSecure(req);

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: (isSecure ? 'none' : 'lax') as 'none' | 'lax',
    partitioned: isSecure,
    path: '/',
    maxAge: 24 * 60 * 60, // 24 hours
  };
}

/**
 * Generates a cryptographically signed JWT session token for admin access.
 */
export async function createAdminSessionToken(): Promise<string> {
  const secret = getSigningSecret();
  return new SignJWT({ admin: true, timestamp: Date.now() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

/**
 * Validates a JWT session token.
 */
export async function verifySessionToken(token: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  try {
    const secret = getSigningSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload.admin === true;
  } catch {
    return false;
  }
}

/**
 * Creates and sets a server-issued HttpOnly admin access session cookie on a NextResponse.
 */
export async function createAdminAccessSession(
  res?: NextResponse,
  req?: NextRequest | Request
): Promise<string> {
  const token = await createAdminSessionToken();
  const options = getCookieOptions(req);

  if (res) {
    res.cookies.set(SESSION_COOKIE_NAME, token, options);
  }

  return token;
}

/**
 * Validates admin authorization for incoming API requests.
 * Checks:
 *  1. x-admin-access-key header (direct key)
 *  2. Authorization: Bearer <key or JWT>
 *  3. x-admin-session header (JWT)
 *  4. HttpOnly admin_access_session cookie (JWT)
 */
export async function verifyAdminAccess(req?: NextRequest | Request): Promise<boolean> {
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  let path = 'unknown';
  let method = 'GET';

  if (req) {
    method = req.method || 'GET';
    if ('url' in req && req.url) {
      try {
        const parsed = new URL(req.url);
        path = parsed.pathname;
      } catch {
        path = req.url;
      }
    }
  }

  let hasHeaderKey = false;
  let hasBearer = false;
  let hasSessionHeader = false;
  let hasCookie = false;

  if (req) {
    // 1. Check x-admin-access-key header
    const headerKey = req.headers.get('x-admin-access-key');
    if (headerKey) {
      hasHeaderKey = true;
      if (adminKey && headerKey === adminKey) {
        return true;
      }
    }

    // 2. Check Authorization Bearer header
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      hasBearer = true;
      const bearerToken = authHeader.substring(7);
      if (adminKey && bearerToken === adminKey) {
        return true;
      }
      // Check if bearer token is a signed JWT
      if (await verifySessionToken(bearerToken)) {
        return true;
      }
    }

    // 3. Check x-admin-session header
    const sessionHeader = req.headers.get('x-admin-session');
    if (sessionHeader) {
      hasSessionHeader = true;
      if (await verifySessionToken(sessionHeader)) {
        return true;
      }
    }
  }

  // 4. Check HttpOnly admin_access_session cookie
  let token: string | undefined;
  if (req) {
    if ('cookies' in req && typeof req.cookies?.get === 'function') {
      token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    } else {
      const cookieHeader = req.headers.get('cookie');
      if (cookieHeader) {
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
        if (match) {
          token = match[1];
        }
      }
    }
  }

  if (token) {
    hasCookie = true;
    const isValid = await verifySessionToken(token);
    if (isValid) {
      return true;
    }
  }

  // 5. If ADMIN_ACCESS_KEY is not set or empty in environment, allow access
  if (!adminKey || adminKey.trim() === '') {
    return true;
  }

  // Log safe diagnostic information without any secret or sensitive tokens
  logger.warn('Admin authorization rejected', {
    path,
    method,
    hasCookie,
    hasSessionHeader,
    hasBearer,
    hasHeaderKey,
    isSecure: isRequestSecure(req),
    reason: hasCookie || hasSessionHeader || hasBearer || hasHeaderKey ? 'invalid_credentials' : 'missing_credentials',
  });

  return false;
}

