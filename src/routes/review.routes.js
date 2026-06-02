'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { createReview } = require('../controllers/review.controller');

const router = Router();

// POST /api/reviews
router.post(
  '/',
  authenticate,
  [
    body('task_id').isUUID().withMessage('task_id must be a valid UUID'),
    body('reviewee_id').isUUID().withMessage('reviewee_id must be a valid UUID'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be an integer between 1 and 5'),
    body('comment').optional().isLength({ max: 2000 }),
  ],
  validate,
  createReview
);

module.exports = router;
