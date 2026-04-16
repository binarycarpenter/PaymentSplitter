// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(amount) {
  return '$' + Math.abs(amount).toFixed(2);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(url, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
  return res.json();
}

const api = {
  getTrips:      ()                    => apiFetch('/api/trips'),
  createTrip:    (data)                => apiFetch('/api/trips',                                   { method: 'POST',  body: data }),
  getTrip:       (id)                  => apiFetch(`/api/trips/${id}`),
  addPerson:     (tripId, data)        => apiFetch(`/api/trips/${tripId}/people`,                  { method: 'POST',  body: data }),
  updatePerson:  (tripId, pid, data)   => apiFetch(`/api/trips/${tripId}/people/${pid}`,           { method: 'PATCH', body: data }),
  deletePerson:  (tripId, pid)         => apiFetch(`/api/trips/${tripId}/people/${pid}`,           { method: 'DELETE' }),
  addExpense:    (tripId, data)        => apiFetch(`/api/trips/${tripId}/expenses`,                { method: 'POST',  body: data }),
  deleteExpense: (tripId, expId)       => apiFetch(`/api/trips/${tripId}/expenses/${expId}`,       { method: 'DELETE' }),
};

// ── Router ────────────────────────────────────────────────────────────────────

function navigate(hash) { location.hash = hash; }

async function route() {
  const app = document.getElementById('app');
  const hash = location.hash || '#/';

  try {
    const tripMatch = hash.match(/^#\/trips\/([\w-]+)$/);
    if (tripMatch) {
      await renderTripPage(app, tripMatch[1]);
    } else {
      await renderTripsPage(app);
    }
  } catch (err) {
    app.innerHTML = `<div class="page"><p class="error-msg">Error: ${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ── Trips list page ───────────────────────────────────────────────────────────

async function renderTripsPage(app) {
  const trips = await api.getTrips();

  app.innerHTML = `
    <div class="page">
      <header class="page-header">
        <h1>Trip Splitter</h1>
      </header>

      <div class="content">
        <section class="card">
          <h2>Create New Trip</h2>
          <form id="newTripForm">
            <div class="form-row">
              <div class="form-group">
                <label for="tripName">Trip name</label>
                <input type="text" id="tripName" placeholder="e.g. Savannah 2024" required autocomplete="off">
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1rem">
              <label>People on the trip</label>
              <div id="peopleBuilder" class="people-builder">
                ${[0,1].map(() => `
                  <div class="person-entry">
                    <input type="text" class="person-input" placeholder="Name" autocomplete="off">
                    <div class="person-size-wrap" title="Group size (e.g. 2 for a couple)">
                      <span class="size-x">×</span>
                      <input type="number" class="person-size" value="1" min="1" max="20">
                    </div>
                    <button type="button" class="btn-icon remove-person" title="Remove">×</button>
                  </div>
                `).join('')}
              </div>
              <button type="button" id="addPersonBtn" class="btn btn-secondary btn-sm" style="align-self:flex-start">+ Add person</button>
            </div>
            <div id="tripFormError" class="error-msg" style="display:none"></div>
            <button type="submit" class="btn btn-primary">Create Trip →</button>
          </form>
        </section>

        ${trips.length > 0 ? `
          <section class="card">
            <h2>Your Trips</h2>
            <div class="trips-grid">
              ${trips.map(t => `
                <a href="#/trips/${t.slug}" class="trip-card">
                  <div>
                    <div class="trip-card-name">${esc(t.name)}</div>
                    <div class="trip-card-meta">${t.people_size > t.people_count ? `${t.people_size} people in ${t.people_count} groups` : `${t.people_count} people`} · ${t.expense_count} expense${t.expense_count !== 1 ? 's' : ''}</div>
                  </div>
                  <span class="trip-card-arrow">›</span>
                </a>
              `).join('')}
            </div>
          </section>
        ` : ''}
      </div>
    </div>
  `;

  // Add person row
  document.getElementById('addPersonBtn').addEventListener('click', () => {
    const builder = document.getElementById('peopleBuilder');
    const row = document.createElement('div');
    row.className = 'person-entry';
    row.innerHTML = `
      <input type="text" class="person-input" placeholder="Name" autocomplete="off">
      <div class="person-size-wrap" title="Group size (e.g. 2 for a couple)">
        <span class="size-x">×</span>
        <input type="number" class="person-size" value="1" min="1" max="20">
      </div>
      <button type="button" class="btn-icon remove-person" title="Remove">×</button>
    `;
    builder.appendChild(row);
    row.querySelector('input').focus();
    updateRemoveButtons();
  });

  // Remove person row (delegated)
  document.getElementById('peopleBuilder').addEventListener('click', e => {
    if (e.target.classList.contains('remove-person')) {
      e.target.closest('.person-entry').remove();
      updateRemoveButtons();
    }
  });

  function updateRemoveButtons() {
    const rows = document.querySelectorAll('.person-entry');
    rows.forEach(row => {
      row.querySelector('.remove-person').disabled = rows.length <= 2;
    });
  }
  updateRemoveButtons();

  // Submit
  document.getElementById('newTripForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('tripFormError');
    errEl.style.display = 'none';

    const name = document.getElementById('tripName').value.trim();
    const people = [...document.querySelectorAll('.person-entry')]
      .map(row => ({
        name: row.querySelector('.person-input').value.trim(),
        size: parseInt(row.querySelector('.person-size').value) || 1,
      }))
      .filter(p => p.name);

    if (people.length < 2) {
      errEl.textContent = 'Please add at least 2 people.';
      errEl.style.display = 'block';
      return;
    }
    const unique = new Set(people.map(p => p.name.toLowerCase()));
    if (unique.size !== people.length) {
      errEl.textContent = 'Each person must have a unique name.';
      errEl.style.display = 'block';
      return;
    }

    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const trip = await api.createTrip({ name, people });
      navigate(`#/trips/${trip.slug}`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
    }
  });
}

// ── Trip detail page ──────────────────────────────────────────────────────────

async function renderTripPage(app, tripSlug, editPeopleOpen = false) {
  const trip = await api.getTrip(tripSlug);

  app.innerHTML = `
    <div class="page">
      <header class="page-header">
        <div class="page-header-main">
          <h1>${esc(trip.name)}</h1>
          <button id="editPeopleBtn" class="btn btn-secondary btn-sm">Edit people</button>
        </div>
        <div class="people-tags">
          ${trip.people.map(p => `<span class="tag">${esc(p.name)}${p.size > 1 ? `<span class="tag-size"> ×${p.size}</span>` : ''}</span>`).join('')}
        </div>
      </header>

      <div class="content">
        ${expenseListHtml(trip)}
        ${settlementHtml(trip)}
      </div>
      ${peopleModalHtml(trip)}
      ${expenseModalHtml(trip)}
    </div>
  `;

  const openPeopleModal = setupPeopleModal(trip, editPeopleOpen);
  setupExpenseForm(trip);
  setupExpenseList(trip);

  // Wire "Add Venmo" buttons in settlement to open the people modal on that person
  document.querySelectorAll('.pay-action-add-venmo').forEach(btn => {
    btn.addEventListener('click', () => openPeopleModal(btn.dataset.personId));
  });
}

// ── People modal ──────────────────────────────────────────────────────────────

function peopleModalHtml(trip) {
  return `
    <div class="modal-overlay" id="peopleModal" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <h2>Edit people</h2>
          <button class="btn-icon modal-close" aria-label="Close">×</button>
        </div>
        <div class="people-edit-list">
          ${trip.people.map(p => `
            <div class="person-edit-row" data-person-id="${p.id}" data-orig-name="${esc(p.name)}" data-orig-size="${p.size}" data-orig-handle="${esc(p.payment_handle || '')}">
              <input type="text" class="person-edit-name person-input" value="${esc(p.name)}" autocomplete="off">
              <div class="person-size-wrap" title="Group size (e.g. 2 for a couple)">
                <span class="size-x">×</span>
                <input type="number" class="person-edit-size person-size" value="${p.size}" min="1" max="20">
              </div>
              <div class="venmo-input-wrap" title="Venmo handle">
                <span class="venmo-prefix">@</span>
                <input type="text" class="person-edit-handle" placeholder="venmo" value="${esc(p.payment_handle || '')}" autocomplete="off">
              </div>
              <button class="btn-icon person-delete-btn" title="Remove ${esc(p.name)}">×</button>
            </div>
          `).join('')}
        </div>
        <div class="person-add-row">
          <input type="text" class="add-person-name person-input" placeholder="Add person…" autocomplete="off">
          <div class="person-size-wrap" title="Group size">
            <span class="size-x">×</span>
            <input type="number" class="add-person-size person-size" value="1" min="1" max="20">
          </div>
          <button class="btn btn-secondary btn-sm add-person-btn">+ Add</button>
        </div>
        <div class="people-editor-footer">
          <div class="people-editor-error error-msg" style="display:none"></div>
          <button class="btn btn-primary people-save-btn">Save changes</button>
        </div>
      </div>
    </div>
  `;
}

function setupPeopleModal(trip, autoOpen = false) {
  const modal   = document.getElementById('peopleModal');
  const errEl   = modal.querySelector('.people-editor-error');
  const saveBtn = modal.querySelector('.people-save-btn');

  function showErr(msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
  function clearErr()   { errEl.style.display = 'none'; }
  function handleEscape(e) { if (e.key === 'Escape') closeModal(); }

  function openModal(focusPersonId) {
    modal.style.display = 'flex';
    document.addEventListener('keydown', handleEscape);
    if (focusPersonId) {
      const row = modal.querySelector(`[data-person-id="${focusPersonId}"]`);
      if (row) {
        const handle = row.querySelector('.person-edit-handle');
        handle.focus();
        handle.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function closeModal() {
    modal.style.display = 'none';
    document.removeEventListener('keydown', handleEscape);
    clearErr();
  }

  document.getElementById('editPeopleBtn').addEventListener('click', () => openModal());
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modal.addEventListener('input', clearErr);

  // Save all edits at once
  saveBtn.addEventListener('click', async () => {
    clearErr();
    const rows = [...modal.querySelectorAll('.person-edit-row')];

    for (const row of rows) {
      if (!row.querySelector('.person-edit-name').value.trim()) {
        showErr('Names cannot be empty.');
        return;
      }
    }

    const changed = rows.filter(row => {
      const name   = row.querySelector('.person-edit-name').value.trim();
      const size   = parseInt(row.querySelector('.person-edit-size').value) || 1;
      const handle = row.querySelector('.person-edit-handle').value.trim().replace(/^@/, '');
      return name !== row.dataset.origName
          || String(size) !== row.dataset.origSize
          || handle !== row.dataset.origHandle;
    });

    if (changed.length === 0) { closeModal(); return; }

    saveBtn.disabled = true;
    try {
      await Promise.all(changed.map(row => {
        const name   = row.querySelector('.person-edit-name').value.trim();
        const size   = parseInt(row.querySelector('.person-edit-size').value) || 1;
        const handle = row.querySelector('.person-edit-handle').value.trim().replace(/^@/, '');
        return api.updatePerson(trip.slug, row.dataset.personId, {
          name, size,
          payment_type:   handle ? 'venmo' : null,
          payment_handle: handle || null,
        });
      }));
      await renderTripPage(document.getElementById('app'), trip.slug, false);
    } catch (err) { showErr(err.message); saveBtn.disabled = false; }
  });

  // Delete person (immediate, with confirm)
  modal.addEventListener('click', async e => {
    const deleteBtn = e.target.closest('.person-delete-btn');
    if (!deleteBtn) return;
    const row  = deleteBtn.closest('.person-edit-row');
    const name = row.dataset.origName;
    if (!confirm(`Remove ${name} from this trip?`)) return;
    deleteBtn.disabled = true;
    try {
      await api.deletePerson(trip.slug, row.dataset.personId);
      await renderTripPage(document.getElementById('app'), trip.slug, true);
    } catch (err) { showErr(err.message); deleteBtn.disabled = false; }
  });

  // Add person (immediate)
  const addBtn = modal.querySelector('.add-person-btn');
  addBtn.addEventListener('click', async () => {
    const nameInput = modal.querySelector('.add-person-name');
    const name = nameInput.value.trim();
    const size = parseInt(modal.querySelector('.add-person-size').value) || 1;
    if (!name) { showErr('Please enter a name.'); return; }
    addBtn.disabled = true;
    try {
      await api.addPerson(trip.slug, { name, size });
      await renderTripPage(document.getElementById('app'), trip.slug, true);
    } catch (err) { showErr(err.message); addBtn.disabled = false; }
  });

  modal.querySelector('.add-person-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });

  if (autoOpen) openModal();
  return openModal;
}

// ── Expense modal ─────────────────────────────────────────────────────────────

function expenseModalHtml(trip) {
  const personOptions = trip.people.map(p =>
    `<option value="${p.id}">${esc(p.name)}</option>`
  ).join('');

  const pillCheckboxes = trip.people.map(p =>
    `<label class="check-pill" data-person-id="${p.id}">
      <input type="checkbox" name="paidForPerson" value="${p.id}">
      ${esc(p.name)}
    </label>`
  ).join('');

  return `
    <div class="modal-overlay" id="expenseModal" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <h2>Add Expense</h2>
          <button class="btn-icon modal-close" aria-label="Close">×</button>
        </div>
        <form id="expenseForm">
          <div class="form-row">
            <div class="form-group">
              <label for="expDesc">Description</label>
              <input type="text" id="expDesc" placeholder="e.g. Dinner at The Grey" autocomplete="off">
            </div>
            <div class="form-group amount-group">
              <label for="expAmount">Amount</label>
              <input type="number" id="expAmount" step="0.01" min="0.01" placeholder="0.00" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="expPaidBy">Paid by</label>
              <select id="expPaidBy" required>
                <option value="">Select person…</option>
                ${personOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Paid for</label>
              <div class="radio-group">
                <label><input type="radio" name="paidForMode" value="all" checked> All people</label>
                <label><input type="radio" name="paidForMode" value="specific"> Specific people</label>
                <label><input type="radio" name="paidForMode" value="except"> All except…</label>
              </div>
              <div id="paidForChecklist" class="people-checklist hidden">
                <span id="checklistHint" class="checklist-hint">Select people:</span>
                ${pillCheckboxes}
              </div>
            </div>
          </div>
          <div id="expenseFormError" class="error-msg" style="display:none"></div>
          <button type="submit" class="btn btn-primary">Add Expense</button>
        </form>
      </div>
    </div>
  `;
}

function setupExpenseForm(trip) {
  const modal     = document.getElementById('expenseModal');
  const checklist = document.getElementById('paidForChecklist');
  const hint      = document.getElementById('checklistHint');

  function handleEscape(e) { if (e.key === 'Escape') closeModal(); }

  function openModal() {
    modal.style.display = 'flex';
    document.getElementById('expDesc').focus();
    document.addEventListener('keydown', handleEscape);
  }

  function closeModal() {
    modal.style.display = 'none';
    document.removeEventListener('keydown', handleEscape);
    document.getElementById('expenseForm').reset();
    checklist.classList.add('hidden');
    document.getElementById('expenseFormError').style.display = 'none';
    document.querySelectorAll('[name="paidForPerson"]').forEach(cb =>
      cb.closest('.check-pill').classList.remove('checked')
    );
  }

  document.getElementById('addExpenseBtn').addEventListener('click', openModal);
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // Toggle checklist visibility + pill styling
  document.querySelectorAll('[name="paidForMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'all') {
        checklist.classList.add('hidden');
      } else {
        checklist.classList.remove('hidden');
        hint.textContent = radio.value === 'specific' ? 'Select people:' : 'Exclude these people:';
        document.querySelectorAll('[name="paidForPerson"]').forEach(cb => {
          cb.checked = false;
          cb.closest('.check-pill').classList.remove('checked');
        });
      }
    });
  });

  checklist.addEventListener('change', e => {
    if (e.target.name === 'paidForPerson')
      e.target.closest('.check-pill').classList.toggle('checked', e.target.checked);
  });

  document.getElementById('expenseForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('expenseFormError');
    errEl.style.display = 'none';

    const description = document.getElementById('expDesc').value.trim();
    const amount  = parseFloat(document.getElementById('expAmount').value);
    const paid_by = parseInt(document.getElementById('expPaidBy').value);
    const mode    = document.querySelector('[name="paidForMode"]:checked').value;

    if (!paid_by) {
      errEl.textContent = 'Please select who paid.';
      errEl.style.display = 'block';
      return;
    }

    let paid_for;
    if (mode === 'all') {
      paid_for = trip.people.map(p => p.id);
    } else {
      const checked = [...document.querySelectorAll('[name="paidForPerson"]:checked')]
        .map(cb => parseInt(cb.value));
      if (mode === 'specific') {
        if (checked.length === 0) {
          errEl.textContent = 'Please select at least one person.';
          errEl.style.display = 'block';
          return;
        }
        paid_for = checked;
      } else {
        paid_for = trip.people.map(p => p.id).filter(id => !checked.includes(id));
        if (paid_for.length === 0) {
          errEl.textContent = "You've excluded everyone. Exclude fewer people.";
          errEl.style.display = 'block';
          return;
        }
      }
    }

    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api.addExpense(trip.slug, { description, amount, paid_by, paid_for });
      await renderTripPage(document.getElementById('app'), trip.slug);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
      btn.disabled = false;
    }
  });
}

// ── Expense list ──────────────────────────────────────────────────────────────

function expenseListHtml(trip) {
  return `
    <section class="card">
      <h2>Expenses${trip.expenses.length > 0 ? ` <span style="color:var(--muted);font-weight:400">(${trip.expenses.length})</span>` : ''}</h2>
      ${trip.expenses.length === 0
        ? `<p class="empty-state">No expenses yet.</p>`
        : `<div class="expense-list" id="expenseList">
            ${trip.expenses.map(exp => expenseRowHtml(exp, trip.people)).join('')}
          </div>`
      }
      <div class="expense-list-footer">
        <button class="btn btn-primary btn-sm" id="addExpenseBtn">+ Add expense</button>
      </div>
    </section>
  `;
}

function expenseRowHtml(exp, allPeople) {
  const paidForDesc = describePaidFor(exp.paid_for, allPeople);
  return `
    <div class="expense-row">
      <div class="expense-info">
        <div class="expense-desc">${esc(exp.description || 'Untitled')}</div>
        <div class="expense-meta">
          Paid by <strong>${esc(exp.paid_by.name)}</strong>
          &nbsp;·&nbsp; for ${paidForDesc}
        </div>
      </div>
      <div class="expense-right">
        <span class="expense-amount">${money(exp.amount)}</span>
        <button class="btn-icon delete-expense" data-expense-id="${exp.id}" title="Delete expense">×</button>
      </div>
    </div>
  `;
}

function describePaidFor(paidFor, allPeople) {
  if (paidFor.length === allPeople.length) return 'everyone';
  if (paidFor.length === 1) return `<strong>${esc(paidFor[0].name)}</strong>`;

  const paidIds = new Set(paidFor.map(p => p.id));
  const excluded = allPeople.filter(p => !paidIds.has(p.id));

  // Show "everyone except X, Y" when it's shorter
  if (excluded.length > 0 && excluded.length < paidFor.length) {
    const names = excluded.map(p => `<strong>${esc(p.name)}</strong>`).join(', ');
    return `everyone except ${names}`;
  }

  return paidFor.map(p => `<strong>${esc(p.name)}</strong>`).join(', ');
}

function setupExpenseList(trip) {
  const list = document.getElementById('expenseList');
  if (!list) return;

  list.addEventListener('click', async e => {
    const btn = e.target.closest('.delete-expense');
    if (!btn) return;
    if (!confirm('Delete this expense?')) return;

    btn.disabled = true;
    try {
      await api.deleteExpense(trip.slug, btn.dataset.expenseId);
      await renderTripPage(document.getElementById('app'), trip.slug);
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
    }
  });
}

// ── Settlement ────────────────────────────────────────────────────────────────

function settlementHtml(trip) {
  const { balances, payments } = trip.settlement;
  const sorted = [...balances].sort((a, b) => b.balance - a.balance);
  const hasExpenses = trip.expenses.length > 0;

  return `
    <section class="card settlement-card">
      <h2>Settlement</h2>

      <div class="settlement-body">
        ${hasExpenses ? `
        <div class="settlement-section">
          <table class="breakdown-table">
            <thead>
              <tr>
                <th>Person</th>
                <th class="col-num">Paid out</th>
                <th class="col-num">Their share</th>
                <th class="col-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(({ person, paid, spentOn, balance }) => {
                const cls  = balance > 0.005 ? 'amt-pos' : balance < -0.005 ? 'amt-neg' : 'amt-zero';
                const sign = balance > 0.005 ? '+' : '';
                const size = person.size > 1 ? `<span class="balance-size"> ×${person.size}</span>` : '';
                return `
                  <tr>
                    <td>${esc(person.name)}${size}</td>
                    <td class="col-num">${money(paid)}</td>
                    <td class="col-num">${money(spentOn)}</td>
                    <td class="col-num"><span class="balance-amt ${cls}">${sign}${money(balance)}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <div class="settlement-section">
          <div class="settlement-label">To settle up</div>
          ${payments.length === 0
            ? `<p class="all-settled">✓ All settled up!</p>`
            : `<div class="payments-list">${payments.map(({ from, to, amount }) => {
                const handle = to.payment_type === 'venmo' && to.payment_handle
                  ? to.payment_handle.replace(/^@/, '') : null;
                const action = handle
                  ? `<a class="pay-action pay-action-venmo" href="https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${amount.toFixed(2)}&note=${encodeURIComponent(trip.name)}" target="_blank" rel="noopener">Pay on Venmo</a>`
                  : `<button class="pay-action pay-action-add-venmo" data-person-id="${to.id}">+ Add Venmo for ${esc(to.name)}</button>`;
                return `
                  <div class="payment-row">
                    <span class="pay-from">${esc(from.name)}</span>
                    <span class="pay-arrow">→</span>
                    <span class="pay-to">${esc(to.name)}</span>
                    <span class="pay-amt">${money(amount)}</span>
                    ${action}
                  </div>
                `;
              }).join('')}</div>`
          }
        </div>
      </div>
    </section>
  `;
}
