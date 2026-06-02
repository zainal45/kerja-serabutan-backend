'use strict';

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5 MB default

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

function imageFilter(req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error('Only JPEG, PNG, and WebP images are allowed');
    err.status = 415;
    cb(err, false);
  }
}

const diskStorage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

/** Avatar upload (single image, 5 MB limit) */
const uploadAvatar = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: imageFilter,
});

/** Task attachment upload (multiple images, 5 MB each) */
const uploadTaskFiles = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: imageFilter,
});

module.exports = { uploadAvatar, uploadTaskFiles };
