const express = require('express');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ── DB pool ───────────────────────────────────────────────────────────────────
// Railway provides DATABASE_URL or individual MYSQL* vars.

const pool = mysql.createPool(
  process.env.DATABASE_URL ?? {
    host:     process.env.MYSQLHOST     || 'localhost',
    port:     process.env.MYSQLPORT     || 3306,
    user:     process.env.MYSQLUSER     || 'root',
    password: process.env.MYSQLPASSWORD || '',
    database: process.env.MYSQLDATABASE || 'trip_splitter',
  }
);

async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] ?? null;
}

// ── Schema ────────────────────────────────────────────────────────────────────

async function initDb() {
  await q(`
    CREATE TABLE IF NOT EXISTS trips (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      name       VARCHAR(255) NOT NULL,
      slug       VARCHAR(255) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS people (
      id       INT PRIMARY KEY AUTO_INCREMENT,
      trip_id  INT NOT NULL,
      name     VARCHAR(100) NOT NULL,
      size     INT NOT NULL DEFAULT 1,
      FOREIGN KEY (trip_id) REFERENCES trips(id)
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS expenses (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      trip_id     INT NOT NULL,
      amount      DECIMAL(10,2) NOT NULL,
      description VARCHAR(500),
      paid_by     INT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (paid_by) REFERENCES people(id)
    )
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS expense_people (
      expense_id INT NOT NULL,
      person_id  INT NOT NULL,
      PRIMARY KEY (expense_id, person_id),
      FOREIGN KEY (expense_id) REFERENCES expenses(id),
      FOREIGN KEY (person_id) REFERENCES people(id)
    )
  `);
}

// ── Settlement logic (ported from Java) ───────────────────────────────────────

async function calculateSettlement(tripId) {
  const people   = await q('SELECT * FROM people WHERE trip_id = ? ORDER BY name', [tripId]);
  const expenses = await q('SELECT * FROM expenses WHERE trip_id = ?', [tripId]);

  const balances = {};
  people.forEach(p => (balances[p.id] = 0));

  for (const expense of expenses) {
    const paidFor = await q(
      `SELECT p.* FROM people p
       JOIN expense_people ep ON p.id = ep.person_id
       WHERE ep.expense_id = ?`,
      [expense.id]
    );
    balances[expense.paid_by] += Number(expense.amount);
    const totalSlots = paidFor.reduce((sum, p) => sum + (p.size || 1), 0);
    const perSlot = Number(expense.amount) / totalSlots;
    paidFor.forEach(p => (balances[p.id] -= perSlot * (p.size || 1)));
  }

  // Backtracking search: find the settlement that maximises the minimum payment,
  // eliminating tiny "not worth it" payments. At each step we pick the first
  // unsettled debtor and try every unsettled lender; we prune any branch whose
  // running minimum already can't beat the best solution found so far.
  const debtors = people
    .filter(p => balances[p.id] < -0.005)
    .map(p => ({ ...p, bal: balances[p.id] }));
  const lenders = people
    .filter(p => balances[p.id] > 0.005)
    .map(p => ({ ...p, bal: balances[p.id] }));

  const best = { minPayment: -1, payments: null };

  function solve(payments, currentMin) {
    // Try largest lenders first so we find a good solution early and prune more
    const active = lenders.filter(l => l.bal > 0.005).sort((a, b) => b.bal - a.bal);
    const debtor = debtors.find(d => d.bal < -0.005);

    // Base case: all debtors settled, or only floating-point residuals remain with
    // no lenders left to absorb them (the old greedy handled this by skipping
    // payments < $0.005; we do the same by treating "no active lenders" as done).
    if (!debtor || active.length === 0) {
      if (currentMin > best.minPayment) {
        best.minPayment = currentMin;
        best.payments = payments.map(p => ({ ...p }));
      }
      return;
    }
    for (const lender of active) {
      const amount = Math.round(Math.min(-debtor.bal, lender.bal) * 100) / 100;
      const newMin = Math.min(currentMin, amount);
      if (newMin <= best.minPayment) continue; // can't improve — prune

      debtor.bal += amount;
      lender.bal -= amount;
      payments.push({ from: { id: debtor.id, name: debtor.name }, to: { id: lender.id, name: lender.name }, amount });

      solve(payments, newMin);

      debtor.bal -= amount;
      lender.bal += amount;
      payments.pop();
    }
  }

  solve([], Infinity);

  return {
    balances: people.map(p => ({
      person:  p,
      balance: Math.round(balances[p.id] * 100) / 100,
    })),
    payments: best.payments ?? [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlug(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/trips', async (req, res) => {
  try {
    const trips = await q(`
      SELECT t.*,
        (SELECT COUNT(*)   FROM people   WHERE trip_id = t.id) AS people_count,
        (SELECT COALESCE(SUM(size), 0) FROM people WHERE trip_id = t.id) AS people_size,
        (SELECT COUNT(*)   FROM expenses WHERE trip_id = t.id) AS expense_count
      FROM trips t ORDER BY t.created_at DESC
    `);
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trips', async (req, res) => {
  const { name, people } = req.body;
  if (!name || !Array.isArray(people) || people.length < 2) {
    return res.status(400).json({ error: 'Need a name and at least 2 people.' });
  }

  const slug = makeSlug(name);
  if (!slug) return res.status(400).json({ error: 'Trip name must contain at least one letter or number.' });

  const existing = await q1('SELECT id FROM trips WHERE slug = ?', [slug]);
  if (existing) return res.status(400).json({ error: `A trip named "${name.trim()}" already exists.` });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [{ insertId: tripId }] = await conn.execute(
      'INSERT INTO trips (name, slug) VALUES (?, ?)', [name.trim(), slug]
    );
    for (const person of people) {
      const personName = typeof person === 'string' ? person : person.name;
      const personSize = typeof person === 'string' ? 1 : (parseInt(person.size) || 1);
      await conn.execute(
        'INSERT INTO people (trip_id, name, size) VALUES (?, ?, ?)',
        [tripId, personName.trim(), personSize]
      );
    }
    await conn.commit();
    const trip = await q1('SELECT * FROM trips WHERE id = ?', [tripId]);
    res.json(trip);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/trips/:slug', async (req, res) => {
  try {
    const trip = await q1('SELECT * FROM trips WHERE slug = ?', [req.params.slug]);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });

    const people      = await q('SELECT * FROM people WHERE trip_id = ? ORDER BY name', [trip.id]);
    const rawExpenses = await q('SELECT * FROM expenses WHERE trip_id = ? ORDER BY created_at DESC', [trip.id]);
    const personById  = Object.fromEntries(people.map(p => [p.id, p]));

    const expenses = await Promise.all(rawExpenses.map(async expense => ({
      ...expense,
      amount:   Number(expense.amount),
      paid_by:  personById[expense.paid_by],
      paid_for: await q(
        `SELECT p.* FROM people p
         JOIN expense_people ep ON p.id = ep.person_id
         WHERE ep.expense_id = ? ORDER BY p.name`,
        [expense.id]
      ),
    })));

    res.json({ ...trip, people, expenses, settlement: await calculateSettlement(trip.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trips/:slug/people', async (req, res) => {
  const { name, size } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

  const trip = await q1('SELECT id FROM trips WHERE slug = ?', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const personSize = Math.max(1, parseInt(size) || 1);
  const duplicate = await q1('SELECT id FROM people WHERE trip_id = ? AND name = ?', [trip.id, name.trim()]);
  if (duplicate) return res.status(400).json({ error: `"${name.trim()}" is already on this trip.` });

  const [{ insertId }] = await pool.execute(
    'INSERT INTO people (trip_id, name, size) VALUES (?, ?, ?)',
    [trip.id, name.trim(), personSize]
  );
  res.json(await q1('SELECT * FROM people WHERE id = ?', [insertId]));
});

app.patch('/api/trips/:slug/people/:personId', async (req, res) => {
  const { name, size } = req.body;
  const trip = await q1('SELECT id FROM trips WHERE slug = ?', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const person = await q1('SELECT * FROM people WHERE id = ? AND trip_id = ?', [req.params.personId, trip.id]);
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const newName = (name ?? person.name).trim();
  const newSize = Math.max(1, parseInt(size) || person.size);
  if (!newName) return res.status(400).json({ error: 'Name cannot be empty.' });

  const duplicate = await q1(
    'SELECT id FROM people WHERE trip_id = ? AND name = ? AND id != ?',
    [trip.id, newName, req.params.personId]
  );
  if (duplicate) return res.status(400).json({ error: `"${newName}" is already on this trip.` });

  await pool.execute('UPDATE people SET name = ?, size = ? WHERE id = ?', [newName, newSize, req.params.personId]);
  res.json(await q1('SELECT * FROM people WHERE id = ?', [req.params.personId]));
});

app.delete('/api/trips/:slug/people/:personId', async (req, res) => {
  const trip = await q1('SELECT id FROM trips WHERE slug = ?', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const person = await q1('SELECT * FROM people WHERE id = ? AND trip_id = ?', [req.params.personId, trip.id]);
  if (!person) return res.status(404).json({ error: 'Person not found.' });

  const usedAsPayer  = await q1('SELECT id FROM expenses WHERE paid_by = ?', [req.params.personId]);
  const usedInSplit  = await q1('SELECT expense_id FROM expense_people WHERE person_id = ?', [req.params.personId]);
  if (usedAsPayer || usedInSplit) {
    return res.status(400).json({ error: `${person.name} is part of existing expenses. Delete those expenses first.` });
  }

  await pool.execute('DELETE FROM people WHERE id = ?', [req.params.personId]);
  res.json({ ok: true });
});

app.post('/api/trips/:slug/expenses', async (req, res) => {
  const { amount, description, paid_by, paid_for } = req.body;
  if (!amount || !paid_by || !Array.isArray(paid_for) || paid_for.length === 0) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const trip = await q1('SELECT id FROM trips WHERE slug = ?', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [{ insertId: expenseId }] = await conn.execute(
      'INSERT INTO expenses (trip_id, amount, description, paid_by) VALUES (?, ?, ?, ?)',
      [trip.id, amount, description || null, paid_by]
    );
    for (const personId of paid_for) {
      await conn.execute('INSERT INTO expense_people (expense_id, person_id) VALUES (?, ?)', [expenseId, personId]);
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/trips/:slug/expenses/:expenseId', async (req, res) => {
  const trip = await q1('SELECT id FROM trips WHERE slug = ?', [req.params.slug]);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM expense_people WHERE expense_id = ?', [req.params.expenseId]);
    await conn.execute('DELETE FROM expenses WHERE id = ? AND trip_id = ?', [req.params.expenseId, trip.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

initDb()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Trip Splitter running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  });
