'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, getClient } = require('../config/database');

const SALT_ROUNDS = 12;

function signAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_EXPIRES_IN || '30d',
  });
}

function buildUserResponse(row) {
  const { password_hash, ...user } = row; // eslint-disable-line no-unused-vars
  return user;
}

// POST /api/auth/register
async function register(req, res, next) {
  const client = await getClient();
  try {
    const { name, email, phone, password, role = 'both' } = req.body;

    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (existing.length > 0) {
      const err = new Error('Email already registered');
      err.status = 409;
      throw err;
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await client.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, role, avatar_url, bio, skills,
                 rating, total_reviews, is_verified, is_active, location_name,
                 created_at, updated_at`,
      [name.trim(), email.toLowerCase().trim(), phone || null, password_hash, role]
    );

    const user = rows[0];
    const token = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);

    // Persist refresh token
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { token, refreshToken, user },
    });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const { rows } = await query(
      `SELECT id, name, email, phone, role, avatar_url, bio, skills,
              rating, total_reviews, is_verified, is_active, location_name,
              password_hash, created_at, updated_at
         FROM users
        WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const user = rows[0];

    if (!user.is_active) {
      const err = new Error('Account deactivated. Please contact support.');
      err.status = 403;
      throw err;
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      const err = new Error('Invalid email or password');
      err.status = 401;
      throw err;
    }

    const token = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

    return res.json({
      success: true,
      data: { token, refreshToken, user: buildUserResponse(user) },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh
async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      const err = new Error('Refresh token required');
      err.status = 400;
      throw err;
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      const err = new Error('Invalid or expired refresh token');
      err.status = 401;
      throw err;
    }

    const { rows } = await query(
      `SELECT id FROM refresh_tokens
        WHERE token = $1 AND user_id = $2 AND expires_at > NOW()`,
      [token, decoded.userId]
    );

    if (rows.length === 0) {
      const err = new Error('Refresh token revoked or expired');
      err.status = 401;
      throw err;
    }

    // Rotate token
    await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);

    const newAccessToken = signAccessToken(decoded.userId);
    const newRefreshToken = signRefreshToken(decoded.userId);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [decoded.userId, newRefreshToken]
    );

    return res.json({
      success: true,
      data: { token: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
async function logout(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (token) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
    }
    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me
async function getMe(req, res) {
  return res.json({ success: true, data: { user: req.user } });
}

module.exports = { register, login, refreshToken, logout, getMe };
