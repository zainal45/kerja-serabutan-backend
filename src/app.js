'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server: SocketIOServer } = require('socket.io');

const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./socket/socket');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const taskRoutes = require('./routes/task.routes');
const chatRoutes = require('./routes/chat.routes');
const reviewRoutes = require('./routes/review.routes');

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (e.g. mobile apps, curl)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads')));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Kerja Serabutan API',
    timestamp: new Date().toISOString(),
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── HTTP + Socket.io server ───────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

initSocket(io);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

httpServer.listen(PORT, () => {
  console.log(`Kerja Serabutan API running on port ${PORT}`);
  console.log(`Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully…`);
  httpServer.close(() => {
    const { pool } = require('./config/database');
    pool.end(() => {
      console.log('Database pool closed. Exiting.');
      process.exit(0);
    });
  });

  // Force exit after 10 s if still hanging
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, httpServer };
