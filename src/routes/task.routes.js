'use strict';

const { Router } = require('express');
const { body, query, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/task.controller');

const router = Router();

// ── Personal task lists (must be declared before /:id) ──────────────────────
router.get('/my/posted', authenticate, ctrl.getMyPostedTasks);
router.get('/my/applied', authenticate, ctrl.getMyAppliedTasks);

// ── Public task list ─────────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('lat').optional().isFloat({ min: -90, max: 90 }),
    query('lng').optional().isFloat({ min: -180, max: 180 }),
    query('radius').optional().isFloat({ min: 0.1, max: 200 }),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.listTasks
);

// POST /api/tasks
router.post(
  '/',
  authenticate,
  [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 255 }),
    body('description').optional().isLength({ max: 5000 }),
    body('category').optional().isLength({ max: 100 }),
    body('budget_min').optional().isFloat({ min: 0 }),
    body('budget_max').optional().isFloat({ min: 0 }),
    body('location_address').optional().isLength({ max: 500 }),
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid lat is required'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid lng is required'),
    body('scheduled_at').optional().isISO8601().withMessage('scheduled_at must be a valid ISO date'),
  ],
  validate,
  ctrl.createTask
);

// GET /api/tasks/:id
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid task id')],
  validate,
  ctrl.getTask
);

// PUT /api/tasks/:id
router.put(
  '/:id',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid task id'),
    body('title').optional().trim().isLength({ min: 1, max: 255 }),
    body('description').optional().isLength({ max: 5000 }),
    body('category').optional().isLength({ max: 100 }),
    body('budget_min').optional().isFloat({ min: 0 }),
    body('budget_max').optional().isFloat({ min: 0 }),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('scheduled_at').optional().isISO8601(),
    body('status').optional().isIn(['open', 'in_progress', 'cancelled']),
  ],
  validate,
  ctrl.updateTask
);

// DELETE /api/tasks/:id
router.delete(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Invalid task id')],
  validate,
  ctrl.deleteTask
);

// POST /api/tasks/:id/apply
router.post(
  '/:id/apply',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid task id'),
    body('proposed_price').optional().isFloat({ min: 0 }),
    body('message').optional().isLength({ max: 1000 }),
  ],
  validate,
  ctrl.applyToTask
);

// GET /api/tasks/:id/applications
router.get(
  '/:id/applications',
  authenticate,
  [param('id').isUUID().withMessage('Invalid task id')],
  validate,
  ctrl.getApplications
);

// PUT /api/tasks/:id/accept/:workerId
router.put(
  '/:id/accept/:workerId',
  authenticate,
  [
    param('id').isUUID().withMessage('Invalid task id'),
    param('workerId').isUUID().withMessage('Invalid worker id'),
  ],
  validate,
  ctrl.acceptWorker
);

// PUT /api/tasks/:id/complete
router.put(
  '/:id/complete',
  authenticate,
  [param('id').isUUID().withMessage('Invalid task id')],
  validate,
  ctrl.completeTask
);

module.exports = router;
