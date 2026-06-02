'use strict';

const { query } = require('../config/database');

// GET /api/users/profile
async function getProfile(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, name, email, phone, role, avatar_url, bio, skills,
              rating, total_reviews, is_verified, is_active, location_name,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              created_at, updated_at
         FROM users
        WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }
    return res.json({ success: true, data: { user: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// PUT /api/users/profile
async function updateProfile(req, res, next) {
  try {
    const { name, bio, skills, location_name, lat, lng, avatar_url, phone } = req.body;

    // Build dynamic SET clause
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (bio !== undefined) { fields.push(`bio = $${idx++}`); values.push(bio); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (avatar_url !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(avatar_url); }
    if (skills !== undefined) {
      const arr = Array.isArray(skills) ? skills : [skills];
      fields.push(`skills = $${idx++}`);
      values.push(arr);
    }
    if (location_name !== undefined) { fields.push(`location_name = $${idx++}`); values.push(location_name); }
    if (lat !== undefined && lng !== undefined) {
      fields.push(`location = ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography`);
      values.push(parseFloat(lng), parseFloat(lat));
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(req.user.id);
    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${idx}
       RETURNING id, name, email, phone, role, avatar_url, bio, skills,
                 rating, total_reviews, is_verified, is_active, location_name,
                 ST_X(location::geometry) AS lng,
                 ST_Y(location::geometry) AS lat,
                 created_at, updated_at`,
      values
    );

    return res.json({ success: true, data: { user: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/nearby?lat=x&lng=y&radius=10
async function getNearbyWorkers(req, res, next) {
  try {
    const { lat, lng, radius = 10, page = 1, limit = 20 } = req.query;

    if (!lat || !lng) {
      const err = new Error('lat and lng query parameters are required');
      err.status = 400;
      throw err;
    }

    const radiusMeters = parseFloat(radius) * 1000;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows } = await query(
      `SELECT id, name, role, avatar_url, bio, skills, rating, total_reviews,
              is_verified, location_name,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              ST_Distance(
                location,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) AS distance_meters
         FROM users
        WHERE is_active = true
          AND role IN ('worker','both')
          AND location IS NOT NULL
          AND ST_DWithin(
                location,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                $3
              )
        ORDER BY distance_meters ASC
        LIMIT $4 OFFSET $5`,
      [parseFloat(lat), parseFloat(lng), radiusMeters, parseInt(limit), offset]
    );

    return res.json({
      success: true,
      data: {
        workers: rows,
        pagination: { page: parseInt(page), limit: parseInt(limit), count: rows.length },
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/users/:id  — public profile
async function getPublicProfile(req, res, next) {
  try {
    const { id } = req.params;

    const { rows } = await query(
      `SELECT id, name, role, avatar_url, bio, skills, rating, total_reviews,
              is_verified, location_name,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              created_at
         FROM users
        WHERE id = $1 AND is_active = true`,
      [id]
    );

    if (rows.length === 0) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }

    return res.json({ success: true, data: { user: rows[0] } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, getNearbyWorkers, getPublicProfile };
