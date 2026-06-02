'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/chat.controller');

const router = Router();

// All chat routes require authentication
router.use(authenticate);

// GET /api/chat/rooms
router.get('/rooms', ctrl.getRooms);

// POST /api/chat/rooms
router.post(
  '/rooms',
  [
    body('other_user_id').isUUID().withMessage('other_user_id must be a valid UUID'),
    body('task_id').optional().isUUID().withMessage('task_id must be a valid UUID'),
  ],
  validate,
  ctrl.createRoom
);

// GET /api/chat/rooms/:roomId/messages
router.get(
  '/rooms/:roomId/messages',
  [
    param('roomId').isUUID().withMessage('Invalid room id'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.getMessages
);

module.exports = router;
