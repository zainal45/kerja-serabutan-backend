'use strict';

const { query, getClient } = require('../config/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

function paginate(page = 1, limit = 20) {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  return { limit: l, offset: (p - 1) * l, page: p };
}

const TASK_SELECT = `
  t.id, t.client_id, t.worker_id, t.title, t.description, t.category,
  t.budget_min, t.budget_max, t.final_price, t.status,
  t.location_address,
  ST_X(t.location::geometry) AS lng,
  ST_Y(t.location::geometry) AS lat,
  t.scheduled_at, t.completed_at, t.created_at, t.updated_at,
  json_build_object(
    'id', u.id, 'name', u.name, 'avatar_url', u.avatar_url,
    'rating', u.rating, 'total_reviews', u.total_reviews
  ) AS client
`;

// ─── Controllers ────────────────────────────────────────────────────────────

// GET /api/tasks
async function listTasks(req, res, next) {
  try {
    const {
      lat, lng, radius = 20, category, status = 'open',
      page = 1, limit = 20,
    } = req.query;

    const { limit: lim, offset, page: pg } = paginate(page, limit);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status) { conditions.push(`t.status = $${idx++}`); values.push(status); }
    if (category) { conditions.push(`t.category = $${idx++}`); values.push(category); }

    if (lat && lng) {
      const radiusMeters = parseFloat(radius) * 1000;
      conditions.push(
        `ST_DWithin(t.location, ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography, $${idx++})`
      );
      values.push(parseFloat(lng), parseFloat(lat), radiusMeters);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countRes = await query(
      `SELECT COUNT(*) FROM tasks t ${where}`,
      values
    );
    const total = parseInt(countRes.rows[0].count);

    // Distance expression for ORDER BY (only when geo filter present)
    const distanceExpr = lat && lng
      ? `, ST_Distance(t.location, ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography) AS distance_meters`
      : '';
    const orderBy = lat && lng ? 'distance_meters ASC' : 't.created_at DESC';
    if (lat && lng) { values.push(parseFloat(lng), parseFloat(lat)); }

    values.push(lim, offset);
    const { rows } = await query(
      `SELECT ${TASK_SELECT} ${distanceExpr}
         FROM tasks t
         JOIN users u ON u.id = t.client_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    return res.json({
      success: true,
      data: {
        tasks: rows,
        pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) },
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/tasks
async function createTask(req, res, next) {
  try {
    const {
      title, description, category,
      budget_min, budget_max,
      location_address, lat, lng,
      scheduled_at,
    } = req.body;

    const { rows } = await query(
      `INSERT INTO tasks
         (client_id, title, description, category, budget_min, budget_max,
          location_address, location, scheduled_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7,
          ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
          $10)
       RETURNING id, client_id, title, description, category, budget_min, budget_max,
                 final_price, status, location_address, scheduled_at,
                 ST_X(location::geometry) AS lng,
                 ST_Y(location::geometry) AS lat,
                 created_at, updated_at`,
      [
        req.user.id, title.trim(), description || null, category || null,
        budget_min || null, budget_max || null,
        location_address || null,
        parseFloat(lng), parseFloat(lat),
        scheduled_at || null,
      ]
    );

    return res.status(201).json({ success: true, data: { task: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// GET /api/tasks/:id
async function getTask(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT ${TASK_SELECT}
         FROM tasks t
         JOIN users u ON u.id = t.client_id
        WHERE t.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      const err = new Error('Task not found');
      err.status = 404;
      throw err;
    }

    // Fetch applications count
    const appRes = await query(
      'SELECT COUNT(*) FROM task_applications WHERE task_id = $1',
      [req.params.id]
    );

    return res.json({
      success: true,
      data: { task: { ...rows[0], application_count: parseInt(appRes.rows[0].count) } },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/tasks/:id
async function updateTask(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await query('SELECT client_id, status FROM tasks WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }
    if (existing.rows[0].client_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }
    if (['completed', 'cancelled'].includes(existing.rows[0].status)) {
      const err = new Error('Cannot edit a completed or cancelled task'); err.status = 400; throw err;
    }

    const {
      title, description, category, budget_min, budget_max,
      location_address, lat, lng, scheduled_at, status,
    } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title.trim()); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }
    if (budget_min !== undefined) { fields.push(`budget_min = $${idx++}`); values.push(budget_min); }
    if (budget_max !== undefined) { fields.push(`budget_max = $${idx++}`); values.push(budget_max); }
    if (location_address !== undefined) { fields.push(`location_address = $${idx++}`); values.push(location_address); }
    if (scheduled_at !== undefined) { fields.push(`scheduled_at = $${idx++}`); values.push(scheduled_at); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (lat !== undefined && lng !== undefined) {
      fields.push(`location = ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography`);
      values.push(parseFloat(lng), parseFloat(lat));
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);
    const { rows } = await query(
      `UPDATE tasks SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${idx}
       RETURNING id, client_id, title, description, category, budget_min, budget_max,
                 final_price, status, location_address, scheduled_at,
                 ST_X(location::geometry) AS lng,
                 ST_Y(location::geometry) AS lat,
                 created_at, updated_at`,
      values
    );

    return res.json({ success: true, data: { task: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/tasks/:id
async function deleteTask(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT client_id, status FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }
    if (rows[0].client_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }
    if (!['open', 'cancelled'].includes(rows[0].status)) {
      const err = new Error('Only open or cancelled tasks can be deleted'); err.status = 400; throw err;
    }

    await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    return res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
}

// POST /api/tasks/:id/apply
async function applyToTask(req, res, next) {
  try {
    const { id: task_id } = req.params;
    const { proposed_price, message } = req.body;

    const taskRes = await query('SELECT client_id, status FROM tasks WHERE id = $1', [task_id]);
    if (taskRes.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }
    if (taskRes.rows[0].status !== 'open') {
      const err = new Error('Task is not open for applications'); err.status = 400; throw err;
    }
    if (taskRes.rows[0].client_id === req.user.id) {
      const err = new Error('You cannot apply to your own task'); err.status = 400; throw err;
    }

    const { rows } = await query(
      `INSERT INTO task_applications (task_id, worker_id, proposed_price, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [task_id, req.user.id, proposed_price || null, message || null]
    );

    return res.status(201).json({ success: true, data: { application: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// GET /api/tasks/:id/applications
async function getApplications(req, res, next) {
  try {
    const { id: task_id } = req.params;

    const taskRes = await query('SELECT client_id FROM tasks WHERE id = $1', [task_id]);
    if (taskRes.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }
    if (taskRes.rows[0].client_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }

    const { rows } = await query(
      `SELECT ta.id, ta.task_id, ta.proposed_price, ta.message, ta.status, ta.created_at,
              json_build_object(
                'id', u.id, 'name', u.name, 'avatar_url', u.avatar_url,
                'rating', u.rating, 'total_reviews', u.total_reviews,
                'skills', u.skills, 'bio', u.bio
              ) AS worker
         FROM task_applications ta
         JOIN users u ON u.id = ta.worker_id
        WHERE ta.task_id = $1
        ORDER BY ta.created_at ASC`,
      [task_id]
    );

    return res.json({ success: true, data: { applications: rows } });
  } catch (err) {
    next(err);
  }
}

// PUT /api/tasks/:id/accept/:workerId
async function acceptWorker(req, res, next) {
  const client = await getClient();
  try {
    const { id: task_id, workerId } = req.params;

    const taskRes = await client.query(
      'SELECT client_id, status FROM tasks WHERE id = $1 FOR UPDATE',
      [task_id]
    );
    if (taskRes.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }
    if (taskRes.rows[0].client_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }
    if (taskRes.rows[0].status !== 'open') {
      const err = new Error('Task is no longer open'); err.status = 400; throw err;
    }

    const appRes = await client.query(
      'SELECT id, proposed_price FROM task_applications WHERE task_id = $1 AND worker_id = $2',
      [task_id, workerId]
    );
    if (appRes.rows.length === 0) {
      const err = new Error('Application not found'); err.status = 404; throw err;
    }

    const { proposed_price } = appRes.rows[0];

    // Accept chosen applicant, reject others
    await client.query(
      `UPDATE task_applications
          SET status = CASE WHEN worker_id = $1 THEN 'accepted' ELSE 'rejected' END
        WHERE task_id = $2`,
      [workerId, task_id]
    );

    const { rows } = await client.query(
      `UPDATE tasks
          SET status = 'assigned', worker_id = $1, final_price = $2, updated_at = NOW()
        WHERE id = $3
       RETURNING *`,
      [workerId, proposed_price, task_id]
    );

    return res.json({ success: true, data: { task: rows[0] } });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// PUT /api/tasks/:id/complete
async function completeTask(req, res, next) {
  try {
    const { id } = req.params;

    const taskRes = await query(
      'SELECT client_id, worker_id, status FROM tasks WHERE id = $1',
      [id]
    );
    if (taskRes.rows.length === 0) {
      const err = new Error('Task not found'); err.status = 404; throw err;
    }

    const task = taskRes.rows[0];
    if (task.client_id !== req.user.id && task.worker_id !== req.user.id) {
      const err = new Error('Forbidden'); err.status = 403; throw err;
    }
    if (!['assigned', 'in_progress'].includes(task.status)) {
      const err = new Error('Task cannot be marked complete in its current state'); err.status = 400; throw err;
    }

    const { rows } = await query(
      `UPDATE tasks
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1
       RETURNING *`,
      [id]
    );

    return res.json({ success: true, data: { task: rows[0] } });
  } catch (err) {
    next(err);
  }
}

// GET /api/tasks/my/posted
async function getMyPostedTasks(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const { limit: lim, offset, page: pg } = paginate(page, limit);

    const conditions = ['t.client_id = $1'];
    const values = [req.user.id];
    let idx = 2;

    if (status) { conditions.push(`t.status = $${idx++}`); values.push(status); }

    values.push(lim, offset);
    const { rows } = await query(
      `SELECT ${TASK_SELECT}
         FROM tasks t
         JOIN users u ON u.id = t.client_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    return res.json({ success: true, data: { tasks: rows, pagination: { page: pg, limit: lim } } });
  } catch (err) {
    next(err);
  }
}

// GET /api/tasks/my/applied
async function getMyAppliedTasks(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { limit: lim, offset, page: pg } = paginate(page, limit);

    const { rows } = await query(
      `SELECT ${TASK_SELECT},
              ta.id AS application_id,
              ta.proposed_price,
              ta.message AS application_message,
              ta.status AS application_status,
              ta.created_at AS applied_at
         FROM task_applications ta
         JOIN tasks t ON t.id = ta.task_id
         JOIN users u ON u.id = t.client_id
        WHERE ta.worker_id = $1
        ORDER BY ta.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, lim, offset]
    );

    return res.json({ success: true, data: { tasks: rows, pagination: { page: pg, limit: lim } } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTasks, createTask, getTask, updateTask, deleteTask,
  applyToTask, getApplications, acceptWorker, completeTask,
  getMyPostedTasks, getMyAppliedTasks,
};
