'use strict';

/**
 * Central error handler.  Must be the last middleware added to Express.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Log server-side
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);

  // Validation errors from express-validator are forwarded as arrays
  if (err.type === 'validation') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors,
    });
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    const detail = err.detail || '';
    let message = 'Duplicate entry';
    if (detail.includes('email')) message = 'Email already registered';
    else if (detail.includes('phone')) message = 'Phone number already registered';
    else if (detail.includes('task_id') && detail.includes('reviewer_id'))
      message = 'You have already reviewed this task';
    else if (detail.includes('task_id') && detail.includes('worker_id'))
      message = 'You have already applied to this task';
    return res.status(409).json({ success: false, message });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced resource not found' });
  }

  // PostgreSQL check constraint
  if (err.code === '23514') {
    return res.status(400).json({ success: false, message: 'Invalid value for constrained field' });
  }

  // JWT errors that somehow slipped through
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File too large' });
  }

  const status = err.status || err.statusCode || 500;
  const message =
    status < 500
      ? err.message
      : process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;

  return res.status(status).json({ success: false, message });
}

/**
 * Wrap an async express handler so thrown errors are forwarded to next().
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
