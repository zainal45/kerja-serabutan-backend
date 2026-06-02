'use strict';

const { Router } = require('express');
const { body, query, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');
const { getUserReviews } = require('../controllers/review.controller');
const { uploadAvatar } = require('../middleware/upload');

const router = Router();

// GET /api/users/profile  — authenticated user's own full profile
router.get('/profile', authenticate, ctrl.getProfile);

// PUT /api/users/profile
router.put(
  '/profile',
  authenticate,
  uploadAvatar.single('avatar'),
  [
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('bio').optional().isLength({ max: 1000 }),
    body('phone').optional().isMobilePhone(),
    body('skills').optional(),
    body('location_name').optional().isLength({ max: 255 }),
    body('lat')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('lat must be between -90 and 90'),
    body('lng')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('lng must be between -180 and 180'),
  ],
  validate,
  ctrl.updateProfile
);

// GET /api/users/nearby
router.get(
  '/nearby',
  authenticate,
  [
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid lat required'),
    query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid lng required'),
    query('radius').optional().isFloat({ min: 0.1, max: 100 }),
  ],
  validate,
  ctrl.getNearbyWorkers
);

// GET /api/users/:id/reviews
router.get(
  '/:id/reviews',
  [param('id').isUUID().withMessage('Invalid user id')],
  validate,
  getUserReviews
);

// GET /api/users/:id  — public profile (must come after named sub-routes)
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid user id')],
  validate,
  ctrl.getPublicProfile
);

module.exports = router;
