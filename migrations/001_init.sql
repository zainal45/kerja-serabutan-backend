-- Kerja Serabutan — initial schema
-- Run: psql $DATABASE_URL -f migrations/001_init.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ──────────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(100) NOT NULL,
  email            VARCHAR(100) UNIQUE NOT NULL,
  phone            VARCHAR(20),
  password_hash    VARCHAR(255) NOT NULL,
  role             VARCHAR(20) DEFAULT 'both' CHECK (role IN ('client','worker','both')),
  avatar_url       TEXT,
  bio              TEXT,
  skills           TEXT[] DEFAULT '{}',
  rating           DECIMAL(3,2) DEFAULT 0,
  total_reviews    INTEGER DEFAULT 0,
  is_verified      BOOLEAN DEFAULT false,
  is_active        BOOLEAN DEFAULT true,
  location         GEOGRAPHY(POINT, 4326),
  location_name    VARCHAR(255),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_location   ON users USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users (role);

-- ──────────────────────────────────────────────
-- TASKS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id        UUID REFERENCES users(id),
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  category         VARCHAR(100),
  budget_min       DECIMAL(12,2),
  budget_max       DECIMAL(12,2),
  final_price      DECIMAL(12,2),
  status           VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','completed','cancelled')),
  location         GEOGRAPHY(POINT, 4326),
  location_address TEXT,
  scheduled_at     TIMESTAMP,
  completed_at     TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_client_id  ON tasks (client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_worker_id  ON tasks (worker_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_category   ON tasks (category);
CREATE INDEX IF NOT EXISTS idx_tasks_location   ON tasks USING GIST (location);

-- ──────────────────────────────────────────────
-- TASK APPLICATIONS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_applications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_price DECIMAL(12,2),
  message        TEXT,
  status         VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_task_id   ON task_applications (task_id);
CREATE INDEX IF NOT EXISTS idx_applications_worker_id ON task_applications (worker_id);
CREATE INDEX IF NOT EXISTS idx_applications_status    ON task_applications (status);

-- ──────────────────────────────────────────────
-- CHAT ROOMS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_rooms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    UUID REFERENCES tasks(id) ON DELETE SET NULL,
  client_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, client_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_client_id ON chat_rooms (client_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_worker_id ON chat_rooms (worker_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_task_id   ON chat_rooms (task_id);

-- ──────────────────────────────────────────────
-- MESSAGES
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  type         VARCHAR(20) DEFAULT 'text' CHECK (type IN ('text','offer','system')),
  offer_price  DECIMAL(12,2),
  offer_status VARCHAR(20) CHECK (offer_status IN ('pending','accepted','rejected')),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id   ON messages (room_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages (created_at DESC);

-- ──────────────────────────────────────────────
-- REVIEWS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_id ON reviews (reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_task_id     ON reviews (task_id);

-- ──────────────────────────────────────────────
-- REFRESH TOKENS
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token   ON refresh_tokens (token);

-- ──────────────────────────────────────────────
-- Auto-update updated_at via trigger
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_tasks_updated_at ON tasks;
CREATE TRIGGER set_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
