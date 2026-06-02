'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const router = Router();

// POST /api/auth/register
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').optional().isMobilePhone().withMessage('Invalid phone number'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
    body('role')
      .optional()
      .isIn(['client', 'worker', 'both'])
      .withMessage('Role must be client, worker, or both'),
  ],
  validate,
  ctrl.register
);

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  ctrl.login
);

// POST /api/auth/refresh
router.post(
  '/refresh',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  validate,
  ctrl.refreshToken
);

// POST /api/auth/logout
router.post('/logout', ctrl.logout);

// GET /api/auth/me
router.get('/me', authenticate, ctrl.getMe);

module.exports = router;
