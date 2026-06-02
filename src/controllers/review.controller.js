'use strict';

const { query, getClient } = require('../config/database');

// POST /api/reviews
async function createReview(req, res, next) {
  const client = await getClient();
  try {
    const { task_id, reviewee_id, rating, comment } = req.body;
    const reviewer_id = req.user.id;

    // Validate task exists and is completed
    const taskRes = await client.query(
      'SELECT id, client_id, worker_id, status FROM tasks WHERE id = $1',
      [task_id]
    );
    if (taskRes.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }

    const task = taskRes.rows[0];
    if (task.status !== 'completed') {
      const err = new Error('Can only review completed tasks'); err.status = 400; throw err;
    }

    // Reviewer must be participant
    if (task.client_id !== reviewer_id && task.worker_id !== reviewer_id) {
      const err = new Error('You are not a participant of this task'); err.status = 403; throw err;
    }

    // Reviewee must be the other participant
    const validReviewee =
      (reviewer_id === task.client_id && reviewee_id === task.worker_id) ||
      (reviewer_id === task.worker_id && reviewee_id === task.client_id);

    if (!validReviewee) {
      const err = new Error('You can only review the other participant of this task'); err.status = 400; throw err;
    }

    // Insert review
    const { rows } = await client.query(
      `INSERT INTO reviews (task_id, reviewer_id, reviewee_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [task_id, reviewer_id, reviewee_id, rating, comment || null]
    );

    // Recalculate reviewee's average rating
    const ratingRes = await client.query(
      'SELECT AVG(rating)::DECIMAL(3,2) AS avg_rating, COUNT(*) AS total FROM reviews WHERE reviewee_id = $1',
      [reviewee_id]
    );

    await client.query(
      `UPDATE users SET rating = $1, total_reviews = $2, updated_at = NOW() WHERE id = $3`,
      [ratingRes.rows[0].avg_rating, ratingRes.rows[0].total, reviewee_id]
    );

    return res.status(201).json({ success: true, data: { review: rows[0] } });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/users/:id/reviews
async function getUserReviews(req, res, next) {
  try {
    const { id: reviewee_id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const lim = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (Math.max(1, parseInt(page)) - 1) * lim;

    const userRes = await query('SELECT id FROM users WHERE id = $1 AND is_active = true', [reviewee_id]);
    if (userRes.rows.length === 0) {
      const err = new Error('User not found'); err.status = 404; throw err;
    }

    const countRes = await query(
      'SELECT COUNT(*) FROM reviews WHERE reviewee_id = $1',
      [reviewee_id]
    );
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await query(
      `SELECT r.id, r.task_id, r.rating, r.comment, r.created_at,
              json_build_object(
                'id', u.id, 'name', u.name, 'avatar_url', u.avatar_url
              ) AS reviewer,
              json_build_object('id', t.id, 'title', t.title) AS task
         FROM reviews r
         JOIN users u ON u.id = r.reviewer_id
         JOIN tasks t ON t.id = r.task_id
        WHERE r.reviewee_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      [reviewee_id, lim, offset]
    );

    const avgRes = await query(
      'SELECT AVG(rating)::DECIMAL(3,2) AS avg_rating FROM reviews WHERE reviewee_id = $1',
      [reviewee_id]
    );

    return res.json({
      success: true,
      data: {
        reviews: rows,
        avg_rating: avgRes.rows[0].avg_rating,
        pagination: {
          page: parseInt(page),
          limit: lim,
          total,
          pages: Math.ceil(total / lim),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { createReview, getUserReviews };
