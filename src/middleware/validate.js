'use strict';

const { validationResult } = require('express-validator');

/**
 * Run after express-validator chains.
 * Collects errors and forwards them to the error handler as a structured object.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const err = new Error('Validation failed');
    err.type = 'validation';
    err.errors = errors.array();
    return next(err);
  }
  next();
}

module.exports = { validate };
