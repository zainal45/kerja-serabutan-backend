'use strict';

const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

/**
 * Authenticate the Socket.io handshake via a Bearer token
 * supplied in auth.token or the Authorization header.
 */
function authenticateSocket(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    (socket.handshake.headers.authorization || '').replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}

/**
 * Verify that the given user is a member of the given chat room.
 * Returns the room row or null.
 */
async function verifyRoomMembership(roomId, userId) {
  const { rows } = await query(
    'SELECT id, client_id, worker_id FROM chat_rooms WHERE id = $1',
    [roomId]
  );
  if (rows.length === 0) return null;
  const room = rows[0];
  if (room.client_id !== userId && room.worker_id !== userId) return null;
  return room;
}

/**
 * Initialise all Socket.io event handlers.
 * @param {import('socket.io').Server} io
 */
function initSocket(io) {
  // Apply JWT auth middleware to every incoming connection
  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (user: ${socket.userId})`);

    // ── join_room ──────────────────────────────────────────────────────────
    socket.on('join_room', async (roomId) => {
      try {
        const room = await verifyRoomMembership(roomId, socket.userId);
        if (!room) {
          socket.emit('error', { event: 'join_room', message: 'Room not found or access denied' });
          return;
        }
        socket.join(roomId);
        socket.emit('joined_room', { roomId });
      } catch (err) {
        console.error('join_room error:', err);
        socket.emit('error', { event: 'join_room', message: 'Server error' });
      }
    });

    // ── leave_room ─────────────────────────────────────────────────────────
    socket.on('leave_room', (roomId) => {
      socket.leave(roomId);
      socket.emit('left_room', { roomId });
    });

    // ── send_message ───────────────────────────────────────────────────────
    socket.on('send_message', async (payload) => {
      try {
        const { roomId, content, type = 'text', offer_price } = payload || {};

        if (!roomId || !content) {
          socket.emit('error', { event: 'send_message', message: 'roomId and content are required' });
          return;
        }

        if (!['text', 'offer'].includes(type)) {
          socket.emit('error', { event: 'send_message', message: 'type must be text or offer' });
          return;
        }

        const room = await verifyRoomMembership(roomId, socket.userId);
        if (!room) {
          socket.emit('error', { event: 'send_message', message: 'Room not found or access denied' });
          return;
        }

        // Persist to DB
        const { rows } = await query(
          `INSERT INTO messages (room_id, sender_id, content, type, offer_price, offer_status)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, room_id, sender_id, content, type, offer_price, offer_status, created_at`,
          [
            roomId,
            socket.userId,
            content,
            type,
            type === 'offer' && offer_price ? parseFloat(offer_price) : null,
            type === 'offer' ? 'pending' : null,
          ]
        );

        const message = rows[0];

        // Enrich with sender info
        const senderRes = await query(
          'SELECT id, name, avatar_url FROM users WHERE id = $1',
          [socket.userId]
        );
        const enriched = { ...message, sender: senderRes.rows[0] };

        // Broadcast to all room members (including sender)
        io.to(roomId).emit('new_message', enriched);
      } catch (err) {
        console.error('send_message error:', err);
        socket.emit('error', { event: 'send_message', message: 'Failed to send message' });
      }
    });

    // ── respond_offer ──────────────────────────────────────────────────────
    socket.on('respond_offer', async (payload) => {
      try {
        const { messageId, status } = payload || {};

        if (!messageId || !status) {
          socket.emit('error', { event: 'respond_offer', message: 'messageId and status are required' });
          return;
        }

        if (!['accepted', 'rejected'].includes(status)) {
          socket.emit('error', { event: 'respond_offer', message: 'status must be accepted or rejected' });
          return;
        }

        // Fetch the message and verify it's an offer
        const msgRes = await query(
          `SELECT m.id, m.room_id, m.sender_id, m.type, m.offer_status
             FROM messages m
            WHERE m.id = $1`,
          [messageId]
        );

        if (msgRes.rows.length === 0) {
          socket.emit('error', { event: 'respond_offer', message: 'Message not found' });
          return;
        }

        const msg = msgRes.rows[0];

        if (msg.type !== 'offer') {
          socket.emit('error', { event: 'respond_offer', message: 'Message is not an offer' });
          return;
        }

        if (msg.offer_status !== 'pending') {
          socket.emit('error', { event: 'respond_offer', message: 'Offer already responded to' });
          return;
        }

        // Only the non-sender can respond
        if (msg.sender_id === socket.userId) {
          socket.emit('error', { event: 'respond_offer', message: 'Cannot respond to your own offer' });
          return;
        }

        const room = await verifyRoomMembership(msg.room_id, socket.userId);
        if (!room) {
          socket.emit('error', { event: 'respond_offer', message: 'Access denied' });
          return;
        }

        const { rows } = await query(
          `UPDATE messages SET offer_status = $1 WHERE id = $2
           RETURNING id, room_id, sender_id, content, type, offer_price, offer_status, created_at`,
          [status, messageId]
        );

        const updated = rows[0];
        io.to(msg.room_id).emit('offer_updated', updated);
      } catch (err) {
        console.error('respond_offer error:', err);
        socket.emit('error', { event: 'respond_offer', message: 'Failed to update offer' });
      }
    });

    // ── typing ─────────────────────────────────────────────────────────────
    socket.on('typing', async (payload) => {
      try {
        const { roomId } = payload || {};
        if (!roomId) return;

        const room = await verifyRoomMembership(roomId, socket.userId);
        if (!room) return;

        // Broadcast to other room members only
        socket.to(roomId).emit('user_typing', { roomId, userId: socket.userId });
      } catch (err) {
        console.error('typing error:', err);
      }
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${socket.id} — ${reason}`);
    });
  });
}

module.exports = { initSocket };
