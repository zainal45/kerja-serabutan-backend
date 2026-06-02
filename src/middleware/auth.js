'use strict';

const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

/**
 * Verify Bearer JWT from Authorization header.
 * Attaches the full user record to req.user on success.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const { rows } = await query(
      `SELECT id, name, email, phone, role, avatar_url, bio, skills,
              rating, total_reviews, is_verified, is_active, location_name,
              created_at, updated_at
         FROM users
        WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware factory — ensure the authenticated user has one of the given roles.
 * @param {...string} roles
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const userRole = req.user.role;
    // 'both' can act as either client or worker
    const effective = userRole === 'both' ? ['client', 'worker', 'both'] : [userRole];
    const allowed = roles.some((r) => effective.includes(r));
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
