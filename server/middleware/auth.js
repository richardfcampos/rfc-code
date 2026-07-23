import crypto from 'crypto';

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { userDb, appConfigDb } from '../modules/database/index.js';
import { IS_PLATFORM } from '../constants/config.js';

// Use env var if set, otherwise auto-generate a unique secret per installation
const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

// AUTH_MODE=trusted skips JWT validation the same way IS_PLATFORM does, but is a
// runtime deployment flag (tailnet-only self-host) rather than a build-time mode.
// Read live (not cached at import) so the boot-time bind guard below and this
// middleware always agree on the current value.
const isTrustedMode = () => process.env.AUTH_MODE === 'trusted';

const TRUSTED_MODE_LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

// Deployment-only escape hatch for the loopback check below. A bridge-networked
// container MUST bind a container-local interface (e.g. 0.0.0.0) for Docker's
// `ports:` publish to reach it — a loopback bind inside the container is
// unreachable from the published port at all. In that topology the network
// boundary this guard exists to protect moves one layer out, from "which
// interface does the Node process bind" to "which host interface does the
// `ports:` publish bind" (see deploy/docker-compose.yml, where the publish is
// restricted to loopback or the tailnet IP — never `0.0.0.0:PORT:PORT`).
// Setting this env var is the operator's explicit acknowledgement of that
// contract; it does not change what trusted mode protects against, only where
// the check for it happens.
const CONTAINER_BIND_CONTRACT_ENV = 'AUTH_TRUSTED_CONTAINER_BIND';

/**
 * Trusted mode has no per-request auth, so the network perimeter (e.g. a
 * Tailscale tailnet) is the only thing standing between the app and the
 * internet. Binding to any non-loopback interface in that mode would expose
 * every session with zero authentication, so refuse to boot instead. No-ops
 * outside trusted mode.
 *
 * Exception: when AUTH_TRUSTED_CONTAINER_BIND=1 is set (see
 * CONTAINER_BIND_CONTRACT_ENV above), a non-loopback bind is accepted — the
 * operator has moved enforcement to the container's published port instead.
 * Without that env var, behavior is unchanged: any non-loopback bind in
 * trusted mode still throws.
 */
const assertTrustedModeBindIsSafe = (host) => {
  if (!isTrustedMode() || TRUSTED_MODE_LOOPBACK_HOSTS.has(host)) {
    return;
  }
  if (process.env[CONTAINER_BIND_CONTRACT_ENV] === '1') {
    return;
  }
  throw new Error(
    `AUTH_MODE=trusted requires HOST to be a loopback address (127.0.0.1, ::1, or localhost); got "${host}". ` +
    'Trusted mode disables login, so the network perimeter is the only protection — ' +
    'binding to a non-loopback address would expose every session without authentication.'
  );
};

/**
 * Trusted mode skips the registration screen entirely, so nobody ever reaches
 * the flow that normally creates the first user. Seed one automatically so
 * authenticateToken/authenticateWebSocket's getFirstUser() lookup succeeds.
 * The password hash is random and never checked — trusted mode never
 * validates credentials. No-ops outside trusted mode or once a user exists.
 */
const seedTrustedModeUser = async () => {
  if (!isTrustedMode() || userDb.hasUsers()) {
    return;
  }
  const randomPassword = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(randomPassword, 12);
  userDb.createUser('trusted-user', passwordHash);
};

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode:  use single database user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Trusted mode: tailnet perimeter replaces per-request JWT auth
  if (isTrustedMode()) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Trusted mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Trusted mode error:', error);
      return res.status(500).json({ error: 'Trusted mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Also check query param for SSE endpoints (EventSource can't set headers)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    // Auto-refresh: if token is past halfway through its lifetime, issue a new one
    if (decoded.exp && decoded.iat) {
      const now = Math.floor(Date.now() / 1000);
      const halfLife = (decoded.exp - decoded.iat) / 2;
      if (now > decoded.iat + halfLife) {
        const newToken = generateToken(user);
        res.setHeader('X-Refreshed-Token', newToken);
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Trusted mode: bypass token validation, return first user
  if (isTrustedMode()) {
    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { id: user.id, userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Trusted mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verify user actually exists in database (matches REST authenticateToken behavior)
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    return { userId: user.id, username: user.username };
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  isTrustedMode,
  assertTrustedModeBindIsSafe,
  seedTrustedModeUser,
  JWT_SECRET
};
