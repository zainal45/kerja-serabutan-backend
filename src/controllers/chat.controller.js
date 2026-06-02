'use strict';

const { query } = require('../config/database');

// GET /api/chat/rooms
async function getRooms(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT
         cr.id,
         cr.task_id,
         cr.created_at,
         -- Task snippet
         json_build_object(
           'id', t.id,
           'title', t.title,
           'status', t.status
         ) AS task,
         -- The other participant from the current user's perspective
         CASE
           WHEN cr.client_id = $1
           THEN json_build_object('id', w.id, 'name', w.name, 'avatar_url', w.avatar_url, 'role', w.role)
           ELSE json_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url, 'role', c.role)
         END AS other_user,
         -- Last message
         (
           SELECT json_build_object(
             'id', m.id, 'content', m.content, 'type', m.type,
             'sender_id', m.sender_id, 'created_at', m.created_at
           )
           FROM messages m
           WHERE m.room_id = cr.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message
       FROM chat_rooms cr
       JOIN users c ON c.id = cr.client_id
       JOIN users w ON w.id = cr.worker_id
       LEFT JOIN tasks t ON t.id = cr.task_id
      WHERE cr.client_id = $1 OR cr.worker_id = $1
      ORDER BY cr.created_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, data: { rooms: rows } });
  } catch (err) {
    next(err);
  }
}

// GET /api/chat/rooms/:roomId/messages
async function getMessages(req, res, next) {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const lim = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (Math.max(1, parseInt(page)) - 1) * lim;

    // Verify membership
    const roomRes = await query(
      'SELECT id, client_id, worker_id FROM chat_rooms WHERE id = $1',
      [roomId]
    );
    if (roomRes.rows.length === 0) {
      const err = new Error('Chat room not found'); err.status = 404; throw err;
    }
    const room = roomRes.rows[0];
    if (room.client_id !== req.user.id && room.worker_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }

    const countRes = await query(
      'SELECT COUNT(*) FROM messages WHERE room_id = $1',
      [roomId]
    );
    const total = parseInt(countRes.rows[0].count);

    const { rows } = await query(
      `SELECT m.id, m.room_id, m.content, m.type, m.offer_price, m.offer_status, m.created_at,
              json_build_object('id', u.id, 'name', u.name, 'avatar_url', u.avatar_url) AS sender
         FROM messages m
         JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3`,
      [roomId, lim, offset]
    );

    // Return in chronological order for the client
    return res.json({
      success: true,
      data: {
        messages: rows.reverse(),
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

// POST /api/chat/rooms
async function createRoom(req, res, next) {
  try {
    const { task_id, other_user_id } = req.body;
    const currentUserId = req.user.id;

    // Determine who is client and who is worker based on task ownership
    let client_id, worker_id;

    if (task_id) {
      const taskRes = await query('SELECT client_id FROM tasks WHERE id = $1', [task_id]);
      if (taskRes.rows.length === 0) {
        const err = new Error('Task not found'); err.status = 404; throw err;
      }
      if (taskRes.rows[0].client_id === currentUserId) {
        client_id = currentUserId;
        worker_id = other_user_id;
      } else {
        client_id = other_user_id;
        worker_id = currentUserId;
      }
    } else {
      // Without a task, initiator is treated as client
      client_id = currentUserId;
      worker_id = other_user_id;
    }

    // Verify other user exists
    const userRes = await query('SELECT id FROM users WHERE id = $1 AND is_active = true', [other_user_id]);
    if (userRes.rows.length === 0) {
      const err = new Error('Other user not found'); err.status = 404; throw err;
    }

    // Upsert room
    const { rows } = await query(
      `INSERT INTO chat_rooms (task_id, client_id, worker_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, client_id, worker_id) DO UPDATE SET task_id = EXCLUDED.task_id
       RETURNING *`,
      [task_id || null, client_id, worker_id]
    );

    return res.status(201).json({ success: true, data: { room: rows[0] } });
  } catch (err) {
    next(err);
  }
}

module.exports = { getRooms, getMessages, createRoom };
