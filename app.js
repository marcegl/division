/* =========================================================
   La Cuenta — bill splitter for friends
   vanilla JS · no build · localStorage + URL-hash sharing
   ========================================================= */

(() => {
  'use strict';

  const STORAGE_KEY = 'lacuenta-v1';

  // Curated palette assigned in order so person dots stay legible together.
  const COLORS = [
    '#8b2942', '#5e6840', '#c9a548', '#6c5687', '#a04a26',
    '#406b6d', '#7b3d3a', '#8a7a4f', '#3a5340', '#b07a35',
  ];

  const CURRENCIES = ['€', '$', '£', 'S/', 'ARS', 'MX$', 'COP'];

  // ─── state ──────────────────────────────────────────────
  const state = {
    people: [],        // { id, name, color }
    expenses: [],      // { id, description, amount, payerId, participantIds, createdAt }
    currency: '€',
    draft: { payer: null, participants: new Set() },
  };

  // ─── utils ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const round2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => `${state.currency} ${n.toFixed(2)}`;

  function nextColor() {
    const used = new Set(state.people.map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[state.people.length % COLORS.length];
  }

  // ─── persistence ─────────────────────────────────────────
  function save() {
    const payload = {
      people: state.people,
      expenses: state.expenses,
      currency: state.currency,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) { /* quota */ }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.people)) state.people = data.people;
      if (Array.isArray(data.expenses)) state.expenses = data.expenses;
      if (typeof data.currency === 'string') state.currency = data.currency;
    } catch (e) { /* ignore */ }
  }

  // ─── share encoding ──────────────────────────────────────
  // Compact wire format: drops random IDs, uses indices + a bitmask
  // for participants, amounts in integer cents. Then gzip + base64url
  // so the link stays short for WhatsApp et al.
  function toWire() {
    const idx = new Map(state.people.map((p, i) => [p.id, i]));
    const expenses = state.expenses
      .filter((e) => idx.has(e.payerId))
      .map((e) => {
        let mask = 0;
        e.participantIds.forEach((id) => {
          const i = idx.get(id);
          if (i != null) mask |= (1 << i);
        });
        return [e.description, Math.round(e.amount * 100), idx.get(e.payerId), mask];
      })
      .filter((row) => row[3] !== 0);
    return {
      c: state.currency,
      p: state.people.map((p) => p.name),
      e: expenses,
    };
  }

  function fromWire(data) {
    if (!data || !Array.isArray(data.p) || !Array.isArray(data.e)) return false;
    const people = data.p.map((name, i) => ({
      id: uid(),
      name: String(name).slice(0, 40),
      color: COLORS[i % COLORS.length],
    }));
    const expenses = data.e.map((row) => {
      if (!Array.isArray(row) || row.length < 4) return null;
      const [description, cents, payerIdx, mask] = row;
      const payer = people[payerIdx];
      if (!payer) return null;
      const partIds = [];
      for (let i = 0; i < people.length; i++) {
        if (mask & (1 << i)) partIds.push(people[i].id);
      }
      if (partIds.length === 0) return null;
      return {
        id: uid(),
        description: String(description).slice(0, 80),
        amount: Math.max(0, Number(cents) / 100),
        payerId: payer.id,
        participantIds: partIds,
        createdAt: Date.now(),
      };
    }).filter(Boolean);
    state.people = people;
    state.expenses = expenses;
    if (typeof data.c === 'string') state.currency = data.c;
    return true;
  }

  function bytesToB64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64UrlToBytes(s) {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (t.length % 4)) % 4;
    if (pad) t += '='.repeat(pad);
    const bin = atob(t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function gzip(str) {
    const s = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function gunzip(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(s).text();
  }

  async function buildShareUrl() {
    const json = JSON.stringify(toWire());
    const gz = await gzip(json);
    return location.origin + location.pathname + '#s=' + bytesToB64Url(gz);
  }

  async function tryLoadFromHash() {
    if (!location.hash.startsWith('#s=')) return false;
    try {
      const bytes = b64UrlToBytes(location.hash.slice(3));
      const json = await gunzip(bytes);
      return fromWire(JSON.parse(json));
    } catch (e) {
      return false;
    }
  }

  // ─── core calculation ────────────────────────────────────
  // Works in integer cents to avoid floating drift; distributes
  // any remainder cents to the first participants (sorted by id
  // so the assignment is deterministic across re-renders).
  function calculate() {
    const cents = new Map();
    state.people.forEach((p) => cents.set(p.id, 0));

    let totalCents = 0;
    for (const e of state.expenses) {
      if (!cents.has(e.payerId)) continue;
      const validParts = e.participantIds.filter((id) => cents.has(id));
      if (validParts.length === 0) continue;

      const c = Math.round(e.amount * 100);
      totalCents += c;
      cents.set(e.payerId, cents.get(e.payerId) + c);

      const share = Math.floor(c / validParts.length);
      const remainder = c - share * validParts.length;
      const sorted = [...validParts].sort();
      sorted.forEach((id, i) => {
        const owed = share + (i < remainder ? 1 : 0);
        cents.set(id, cents.get(id) - owed);
      });
    }

    const balances = new Map();
    for (const [id, c] of cents) balances.set(id, c / 100);

    // Greedy minimum-cash-flow: pair biggest debtor with biggest creditor.
    const debtors = [];
    const creditors = [];
    for (const [id, bal] of balances) {
      if (bal < -0.005) debtors.push({ id, amount: -bal });
      else if (bal > 0.005) creditors.push({ id, amount: bal });
    }
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amount, creditors[j].amount);
      const payR = round2(pay);
      if (payR > 0) {
        transactions.push({ from: debtors[i].id, to: creditors[j].id, amount: payR });
      }
      debtors[i].amount = round2(debtors[i].amount - pay);
      creditors[j].amount = round2(creditors[j].amount - pay);
      if (debtors[i].amount < 0.005) i++;
      if (creditors[j].amount < 0.005) j++;
    }

    return { balances, transactions, total: totalCents / 100 };
  }

  // ─── renderers ───────────────────────────────────────────
  function renderPeople() {
    const list = $('#people-list');
    list.innerHTML = '';
    state.people.forEach((p) => {
      const chip = document.createElement('div');
      chip.className = 'person-chip';
      chip.style.setProperty('--color', p.color);
      chip.setAttribute('role', 'listitem');

      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.type = 'button';
      rm.setAttribute('aria-label', `Eliminar ${p.name}`);
      rm.textContent = '×';
      rm.addEventListener('click', () => removePerson(p.id));

      chip.append(dot, name, rm);
      list.appendChild(chip);
    });
    renderPayerChips();
    renderParticipantChips();
  }

  function renderChipGroup(container, selectedTest, onToggle) {
    container.innerHTML = '';
    state.people.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.style.setProperty('--color', p.color);
      btn.setAttribute('aria-pressed', String(selectedTest(p.id)));
      btn.textContent = p.name;
      btn.addEventListener('click', () => onToggle(p.id));
      container.appendChild(btn);
    });
  }

  function renderPayerChips() {
    if (state.draft.payer && !state.people.find((p) => p.id === state.draft.payer)) {
      state.draft.payer = null;
    }
    renderChipGroup(
      $('#payer-chips'),
      (id) => state.draft.payer === id,
      (id) => {
        state.draft.payer = state.draft.payer === id ? null : id;
        renderPayerChips();
      },
    );
  }

  function renderParticipantChips() {
    // Drop participants for removed people.
    state.draft.participants = new Set(
      [...state.draft.participants].filter((id) => state.people.some((p) => p.id === id)),
    );
    renderChipGroup(
      $('#participant-chips'),
      (id) => state.draft.participants.has(id),
      (id) => {
        if (state.draft.participants.has(id)) state.draft.participants.delete(id);
        else state.draft.participants.add(id);
        renderParticipantChips();
      },
    );
  }

  function renderExpenses() {
    const list = $('#expenses-list');
    list.innerHTML = '';
    state.expenses.forEach((e) => {
      const li = document.createElement('li');
      li.className = 'expense';
      const payer = state.people.find((p) => p.id === e.payerId);
      const valid = e.participantIds.filter((id) => state.people.some((p) => p.id === id));
      const partsLabel = valid.length === state.people.length && valid.length > 0
        ? `entre todos · ${valid.length}`
        : `entre ${valid.length} ${valid.length === 1 ? 'persona' : 'personas'}`;

      const left = document.createElement('div');
      const desc = document.createElement('span'); desc.className = 'desc'; desc.textContent = e.description;
      const meta = document.createElement('span'); meta.className = 'desc-meta'; meta.textContent = partsLabel;
      left.append(desc, meta);

      const payerEl = document.createElement('span'); payerEl.className = 'payer';
      payerEl.textContent = payer ? payer.name : '—';

      const amount = document.createElement('span'); amount.className = 'amount';
      amount.textContent = fmt(e.amount);

      const rm = document.createElement('button');
      rm.className = 'remove'; rm.type = 'button';
      rm.setAttribute('aria-label', `Eliminar gasto ${e.description}`);
      rm.textContent = '×';
      rm.addEventListener('click', () => removeExpense(e.id));

      li.append(left, payerEl, amount, rm);
      list.appendChild(li);
    });
  }

  function renderTotalsAndMeta(total) {
    $('#subtotal').textContent = total > 0 ? fmt(total) : '—';
    $('#total').textContent = total > 0 ? fmt(total) : '—';
    $('#expense-count').textContent = String(state.expenses.length);

    const peopleN = state.people.length;
    const expN = state.expenses.length;
    let meta;
    if (expN === 0 && peopleN === 0) meta = '— sin nada todavía —';
    else if (expN === 0) meta = `${peopleN} ${peopleN === 1 ? 'comensal' : 'comensales'} · sin gastos`;
    else meta = `${expN} ${expN === 1 ? 'gasto' : 'gastos'} · ${peopleN} ${peopleN === 1 ? 'comensal' : 'comensales'}`;
    $('#receipt-meta').textContent = meta;

    const stamp = $('#totals-stamp');
    if (total === 0 || peopleN === 0) stamp.textContent = '— pendiente —';
    else {
      const per = total / peopleN;
      stamp.textContent = `≈ ${fmt(per)} por persona (promedio)`;
    }
  }

  function renderSettle({ balances, transactions }) {
    const balContainer = $('#balances');
    const txContainer = $('#transactions');
    const hint = $('#settle-hint');
    const seal = $('#seal');

    balContainer.innerHTML = '';
    txContainer.innerHTML = '';

    if (state.people.length === 0 || state.expenses.length === 0) {
      hint.classList.remove('hidden');
      hint.textContent = state.people.length === 0
        ? 'Añade comensales para empezar.'
        : 'Añade al menos un gasto para ver el reparto.';
      seal.classList.remove('visible');
      return;
    }

    hint.classList.add('hidden');

    state.people.forEach((p) => {
      const bal = balances.get(p.id) || 0;
      const li = document.createElement('li');
      let cls = 'even';
      if (bal > 0.005) cls = 'creditor';
      else if (bal < -0.005) cls = 'debtor';
      li.className = `balance-row ${cls}`;
      li.style.setProperty('--color', p.color);

      const nameSpan = document.createElement('span'); nameSpan.className = 'name';
      const dot = document.createElement('span'); dot.className = 'dot';
      const txt = document.createElement('span'); txt.textContent = p.name;
      nameSpan.append(dot, txt);

      const num = document.createElement('span'); num.className = 'num';
      num.textContent = Math.abs(bal) < 0.005 ? 'al día' : fmt(Math.abs(bal));

      li.append(nameSpan, num);
      balContainer.appendChild(li);
    });

    if (transactions.length === 0) {
      seal.classList.add('visible');
      const li = document.createElement('li');
      li.className = 'transaction';
      const flow = document.createElement('span'); flow.className = 'flow';
      flow.innerHTML = '<em>todo cuadra — nadie debe nada.</em>';
      const am = document.createElement('span'); am.className = 'amount'; am.textContent = '·';
      li.append(flow, am);
      txContainer.appendChild(li);
    } else {
      seal.classList.remove('visible');
      transactions.forEach((tx) => {
        const from = state.people.find((p) => p.id === tx.from);
        const to = state.people.find((p) => p.id === tx.to);
        if (!from || !to) return;
        const li = document.createElement('li');
        li.className = 'transaction';

        const flow = document.createElement('span'); flow.className = 'flow';
        const f = document.createElement('span'); f.className = 'from'; f.textContent = from.name;
        const a = document.createElement('span'); a.className = 'arrow'; a.textContent = 'paga a';
        const t = document.createElement('span'); t.className = 'to'; t.textContent = to.name;
        flow.append(f, a, t);

        const am = document.createElement('span'); am.className = 'amount';
        am.textContent = fmt(tx.amount);

        li.append(flow, am);
        txContainer.appendChild(li);
      });
    }
  }

  function rerender() {
    const result = calculate();
    renderPeople();
    renderExpenses();
    renderTotalsAndMeta(result.total);
    renderSettle(result);
    save();
  }

  // ─── actions ─────────────────────────────────────────────
  function addPerson(name) {
    const n = name.trim();
    if (!n) return;
    if (state.people.find((p) => p.name.toLowerCase() === n.toLowerCase())) {
      toast(`${n} ya está en la mesa`);
      return;
    }
    const person = { id: uid(), name: n, color: nextColor() };
    state.people.push(person);
    // Auto-include in the current draft — usually you want them in the next gasto.
    state.draft.participants.add(person.id);
    rerender();
  }

  function removePerson(id) {
    state.people = state.people.filter((p) => p.id !== id);
    // Cascade: drop expenses whose payer is gone, prune participants.
    state.expenses = state.expenses.filter((e) => state.people.some((p) => p.id === e.payerId));
    state.expenses.forEach((e) => {
      e.participantIds = e.participantIds.filter((pid) => state.people.some((p) => p.id === pid));
    });
    state.expenses = state.expenses.filter((e) => e.participantIds.length > 0);
    if (state.draft.payer === id) state.draft.payer = null;
    state.draft.participants.delete(id);
    rerender();
  }

  function addExpense({ description, amount, payerId, participantIds }) {
    state.expenses.push({
      id: uid(),
      description,
      amount: round2(amount),
      payerId,
      participantIds: [...participantIds],
      createdAt: Date.now(),
    });
    // Clear payer for next entry, leave participants (likely the same group).
    state.draft.payer = null;
    rerender();
  }

  function removeExpense(id) {
    state.expenses = state.expenses.filter((e) => e.id !== id);
    rerender();
  }

  // ─── toast ───────────────────────────────────────────────
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ─── wire up ─────────────────────────────────────────────
  async function init() {
    // A shared link in the hash takes precedence over what's saved locally.
    if (location.hash.startsWith('#s=')) {
      const ok = await tryLoadFromHash();
      if (ok) {
        history.replaceState(null, '', location.pathname + location.search);
        save();
      } else {
        loadFromStorage();
      }
    } else {
      loadFromStorage();
    }

    // Hydrate the draft.participants with everyone by default.
    state.people.forEach((p) => state.draft.participants.add(p.id));

    $('#currency-symbol').textContent = state.currency;
    $('#btn-currency').textContent = state.currency;

    $('#add-person-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#new-person-input');
      addPerson(input.value);
      input.value = '';
      input.focus();
    });

    $('#expense-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const description = form.description.value.trim();
      const amount = parseFloat(form.amount.value);

      if (state.people.length === 0) { toast('Añade primero a los comensales.'); return; }
      if (!description) { toast('Falta el concepto.'); return; }
      if (isNaN(amount) || amount <= 0) { toast('Monto inválido.'); return; }
      if (!state.draft.payer) { toast('Marca quién pagó.'); return; }
      const participants = [...state.draft.participants];
      if (participants.length === 0) { toast('Marca al menos un comensal.'); return; }

      addExpense({ description, amount, payerId: state.draft.payer, participantIds: participants });
      form.description.value = '';
      form.amount.value = '';
      form.description.focus();
      toast('añadido al ticket.');
    });

    $('#toggle-all').addEventListener('click', () => {
      if (state.people.length === 0) return;
      const allSelected = state.people.every((p) => state.draft.participants.has(p.id));
      if (allSelected) state.draft.participants.clear();
      else state.people.forEach((p) => state.draft.participants.add(p.id));
      renderParticipantChips();
    });

    $('#btn-currency').addEventListener('click', () => {
      const idx = CURRENCIES.indexOf(state.currency);
      state.currency = CURRENCIES[(idx + 1) % CURRENCIES.length];
      $('#btn-currency').textContent = state.currency;
      $('#currency-symbol').textContent = state.currency;
      rerender();
    });

    $('#btn-share').addEventListener('click', async () => {
      if (state.people.length === 0 && state.expenses.length === 0) {
        toast('no hay nada que compartir todavía.');
        return;
      }
      const url = await buildShareUrl();
      try {
        await navigator.clipboard.writeText(url);
        toast('enlace copiado al portapapeles.');
      } catch (e) {
        window.prompt('Copia este enlace para compartir:', url);
      }
    });

    $('#btn-reset').addEventListener('click', () => {
      if (state.people.length === 0 && state.expenses.length === 0) {
        toast('ya está vacío.');
        return;
      }
      if (!confirm('¿Vaciar el ticket por completo? Esta acción no se puede deshacer.')) return;
      state.people = [];
      state.expenses = [];
      state.draft.payer = null;
      state.draft.participants.clear();
      rerender();
      toast('cuenta nueva.');
    });

    // Pre-render with current state.
    rerender();

    // Focus convenience on first load when empty.
    if (state.people.length === 0) {
      setTimeout(() => $('#new-person-input').focus(), 250);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
