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

  // Greedy settlement: pair each debtor against each lender
  const debtors = people
    .filter(p => balances[p.id] < -0.005)
    .map(p => ({ ...p, balance: balances[p.id] }));
  const lenders = people
    .filter(p => balances[p.id] > 0.005)
    .map(p => ({ ...p, balance: balances[p.id] }));

  const payments = [];
  for (const debtor of debtors) {
    for (const lender of lenders) {
      const amount = Math.min(Math.abs(debtor.balance), lender.balance);
      if (amount < 0.005) continue;
      debtor.balance += amount;
      lender.balance -= amount;
      payments.push({
        from:   { id: debtor.id, name: debtor.name },
        to:     { id: lender.id, name: lender.name },
        amount: Math.round(amount * 100) / 100,
      });
    }
  }

  return {
    balances: people.map(p => ({
      person:  p,
      balance: Math.round(balances[p.id] * 100) / 100,
    })),
    payments,
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
        (SELECT COUNT(*) FROM people   WHERE trip_id = t.id) AS people_count,
        (SELECT COUNT(*) FROM expenses WHERE trip_id = t.id) AS expense_count
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
