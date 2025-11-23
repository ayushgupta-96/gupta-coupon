// ==============================
// script.js (paste entire file)
// ==============================

// ------- CONFIG -------
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwVylIHzmbjmhEOxpww7-MSVPGmhr0aRmER1xYx-IRXj7qVXEOI4OQZYFyxzxxP61TmMQ/exec";
const SECRET_TOKEN = "Niraj@9631"; // must match Apps Script token

const TYPE_MAP = { F20: "F20", F19: "F19", F17: "F17" };

// Edit catalog / stock here
const CATALOG = [
  { id: 'F20', title: 'Flipkart 20-digit coupon', price: 6, length: 20, stock: 1000 },
  { id: 'F19', title: 'Flipkart 19-digit coupon', price: 6, length: 19, stock: 0 },
  { id: 'F17', title: 'Flipkart 17-digit coupon', price: 6, length: 17, stock: 0 }
];

const PLATFORM_FEE = 0;
const OFFER_MIN_QTY = 100;
const OFFER_RATE = 0.10;

// ------- STATE -------
const state = {
  items: {},      // qty per item id
  total: 0,
  offerApplied: false
};

// ------- DOM REFS -------
const couponListEl = document.getElementById('couponList');
const receiptBody   = document.getElementById('receiptBody');
const shareBtn      = document.getElementById('shareWA');
const deliveredEl   = document.getElementById('deliveredCodes');

const applyOfferEl  = document.getElementById('applyOffer');
const offerStatusEl = document.getElementById('offerStatus');
const discountRowEl = document.getElementById('discountRow');
const discountEl    = document.getElementById('discount');

// For verify/pay flow
let _lastRequests = [];  // [{type, qty}]
let _lastOrderId = null;
let _lastGrandTotal = 0;
let _deliveredResults = null; // last deliverCodes results

// ------- UTILS -------
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
}

function on(el, ev, fn){ if (el) el.addEventListener(ev, fn); }

// JSONP helper (for Apps Script without CORS)
function jsonpRequest(baseUrl, params) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const url = baseUrl + "?" + new URLSearchParams({ ...params, callback: cbName }).toString();

    window[cbName] = (data) => { resolve(data); cleanup(); };
    const s = document.createElement("script");
    s.src = url;
    s.onerror = () => { reject(new Error("JSONP failed")); cleanup(); };
    document.head.appendChild(s);

    function cleanup(){
      try { delete window[cbName]; } catch (e) {}
      if (s.parentNode) s.parentNode.removeChild(s);
    }
  });
}

// ------- RENDER / UI -------

function renderCoupons(){
  if (!couponListEl) return;
  couponListEl.innerHTML = '';

  CATALOG.forEach(item => {
    const wrap = document.createElement('div');
    wrap.className = 'coupon' + (item.stock === 0 ? ' oos' : '');

    const stockText = item.stock === 0 ? 'Out of stock' : item.stock;

    const title = document.createElement('div');
    title.innerHTML = `<strong>${escapeHtml(item.title)}</strong>
      <div class="muted">ID: ${item.id} • Length: ${item.length} digits • Stock: ${stockText}</div>`;

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = `₹${item.price} / coupon`;

    const qty = document.createElement('div');
    qty.className = 'qty';
    const disabled = item.stock === 0 ? 'disabled' : '';
    const current = state.items[item.id] || 0;

    qty.innerHTML = `
      <input ${disabled} type="number" min="0" max="${item.stock}" step="1"
             id="qty-${item.id}" value="${current}">
    `;

    const inputEl = qty.querySelector('input');
    if (inputEl) {
      inputEl.addEventListener('input', () => {
        let val = parseInt(inputEl.value || '0', 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > item.stock) val = item.stock;
        state.items[item.id] = val;
        inputEl.value = val;
        recalc();
      });
    }

    wrap.appendChild(title);
    wrap.appendChild(price);
    wrap.appendChild(qty);
    couponListEl.appendChild(wrap);
  });
}

function recalc(){
  const subtotal = Object.entries(state.items).reduce((acc, [id, q]) => {
    const item = CATALOG.find(i => i.id === id);
    const qty = Number(q) || 0;
    return acc + (item ? item.price * qty : 0);
  }, 0);

  const totalQty = Object.values(state.items).reduce((a,n) => a + (Number(n) || 0), 0);
  const eligible = totalQty >= OFFER_MIN_QTY;

  if (applyOfferEl) {
    applyOfferEl.disabled = !eligible;
    if (!eligible) {
      state.offerApplied = false;
      applyOfferEl.checked = false;
    }
  }
  if (offerStatusEl) {
    offerStatusEl.textContent = eligible ? (state.offerApplied ? 'Applied' : 'Eligible') : 'Not eligible';
  }

  const discount = state.offerApplied && eligible ? Math.round(subtotal * OFFER_RATE) : 0;
  const fee = subtotal > 0 ? PLATFORM_FEE : 0;
  const total = subtotal - discount + fee;

  document.getElementById('subtotal').textContent = `₹${subtotal}`;
  document.getElementById('fee').textContent = `₹${fee}`;
  document.getElementById('total').textContent = `₹${total}`;

  if (discountRowEl && discountEl) {
    discountRowEl.style.display = discount > 0 ? '' : 'none';
    discountEl.textContent = `–₹${discount}`;
  }

  state.total = total;
}

// ------- ORDER / DELIVER CODES -------

async function deliverCodes(orderId, requests, receiptBodyLocal){
  // Make JSONP requests for each item type, return results array
  const results = [];
  for (const r of requests) {
    try {
      const data = await jsonpRequest(WEB_APP_URL, {
        token: SECRET_TOKEN,
        type: r.type,
        qty: String(r.qty),
        orderId
      });
      results.push({ req: r, ok: !!data.ok, codes: data.codes || [], error: data.error });
    } catch (err) {
      results.push({ req: r, ok: false, codes: [], error: String(err) });
    }
  }

  // Build blocks HTML for receipt (and step 3)
  const blocksHtml = results.map(x => {
    if (!x.ok) return `<div class="notice">(${x.req.type}) ${escapeHtml(x.error || 'failed')}</div>`;
    const codesHtml = (x.codes || []).map(c => `<code>${escapeHtml(c)}</code>`).join('<br>');
    return `<div><strong>${escapeHtml(x.req.type)} codes</strong>
             <div style="margin-top:6px">${codesHtml}</div></div>`;
  }).join('<div class="divider"></div>');

  if (receiptBodyLocal) {
    receiptBodyLocal.innerHTML += `
      <div class="divider"></div>
      <div><strong>Delivered codes</strong></div>
      <div style="margin-top:6px">${blocksHtml}</div>
    `;
  }

  // Put into Step 3 panel
  if (deliveredEl) deliveredEl.innerHTML = blocksHtml || '<div class="muted">No codes delivered.</div>';

  // Update local stock and UI
  results.forEach(r => {
    if (r.ok) {
      const cat = CATALOG.find(c => TYPE_MAP[c.id] === r.req.type);
      if (cat) cat.stock = Math.max(0, cat.stock - r.req.qty);
    }
  });
  renderCoupons();

  _deliveredResults = results;
  return results;
}

// ------- GENERATE ORDER (does NOT auto-deliver) -------
async function generateOrder(){
  const name  = (document.getElementById('buyerName') || {}).value?.trim() || '';
  const phone = (document.getElementById('buyerPhone') || {}).value?.trim() || '';
  const note  = (document.getElementById('buyerNote') || {}).value?.trim() || '';

  if (state.total <= 0) { alert('Please add at least one coupon.'); return; }
  if (phone && !/^\d{10}$/.test(phone)) { alert('Enter a valid 10-digit phone number, or leave it empty.'); return; }

  // Build lines for receipt
  const lines = Object.entries(state.items)
    .filter(([_, q]) => Number(q) > 0)
    .map(([id, q]) => {
      const item = CATALOG.find(i => i.id === id);
      const qty = Number(q) || 0;
      const amt = item ? item.price * qty : 0;
      return `<tr><td>${escapeHtml(item ? item.title : id)}</td>
                 <td style="text-align:center">${qty}</td>
                 <td style="text-align:right">₹${amt}</td></tr>`;
    }).join('');

  // order meta
  const now = new Date();
  const orderId = 'ORD' + now.getFullYear().toString().slice(-2)
                + (now.getMonth()+1).toString().padStart(2,'0')
                + now.getDate().toString().padStart(2,'0')
                + '-' + Math.random().toString(36).slice(2,6).toUpperCase();

  // recompute totals
  const subForReceipt = Object.entries(state.items).reduce((acc, [id,q])=>{
    const item = CATALOG.find(i => i.id === id);
    const qty = Number(q) || 0;
    return acc + (item ? item.price * qty : 0);
  }, 0);
  const totalQtyForReceipt = Object.values(state.items).reduce((a,n)=>a + (Number(n)||0), 0);
  const eligibleOffer = totalQtyForReceipt >= OFFER_MIN_QTY;
  const discountForReceipt = (state.offerApplied && eligibleOffer) ? Math.round(subForReceipt * OFFER_RATE) : 0;
  const feeForReceipt = subForReceipt > 0 ? PLATFORM_FEE : 0;
  const grandTotal = subForReceipt - discountForReceipt + feeForReceipt;

  // save last order info for verification step
  _lastOrderId = orderId;
  _lastGrandTotal = grandTotal;

  // store pending requests (type names must match Apps Script)
  const requests = Object.entries(state.items)
    .filter(([_, q]) => Number(q) > 0)
    .map(([id, q]) => ({ type: TYPE_MAP[id], qty: Number(q) }));
  _lastRequests = requests;

  // update receipt (display summary)
  if (receiptBody) {
    receiptBody.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:6px;">
        <div>
          <div><strong>Order ID:</strong> ${escapeHtml(orderId)}</div>
          <div class="muted">Date: ${now.toLocaleString()}</div>
        </div>
        <div style="text-align:right;">
          ${name ? `<div><strong>Name:</strong> ${escapeHtml(name)}</div>` : ''}
          ${phone ? `<div class="muted">Phone: ${escapeHtml(phone)}</div>` : ''}
        </div>
      </div>
      <div class="divider"></div>
      <table style="width:100%; border-collapse: collapse;">
        <thead><tr style="color:var(--muted);text-align:left"><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${lines}</tbody>
        <tfoot>
          <tr><td></td><td style="text-align:right;color:var(--muted)">Subtotal</td><td style="text-align:right">₹${subForReceipt}</td></tr>
          ${discountForReceipt>0?`<tr><td></td><td style="text-align:right;color:var(--muted)">Discount</td><td style="text-align:right">-₹${discountForReceipt}</td></tr>`:''}
          <tr><td></td><td style="text-align:right;color:var(--muted)">Fee</td><td style="text-align:right">₹${feeForReceipt}</td></tr>
          <tr><td></td><td style="text-align:right;font-weight:800">Total</td><td style="text-align:right;font-weight:800">₹${grandTotal}</td></tr>
        </tfoot>
      </table>
      <div class="divider"></div>
      ${note ? `<div class="muted"><strong>Note:</strong> ${escapeHtml(note)}</div><div class="divider"></div>` : ''}
      <div class="notice">Pay via UPI to <strong>${escapeHtml(document.getElementById('upiId')?.textContent||'')}</strong>. After payment enter the UTR and click "Verify payment & show codes".</div>
    `;
  }

  // set whatsapp message link
  let msg = `*Coupon Order*%0AOrder ID: ${orderId}%0ATotal: ₹${grandTotal}%0AItems:%0A` +
    requests.map(r => `- ${r.type} x ${r.qty}`).join('%0A');
  if (name) msg = `*Coupon Order*%0AOrder ID: ${orderId}%0AName: ${encodeURIComponent(name)}%0A` + msg.slice('*Coupon Order*%0A'.length);
  if (grandTotal) msg += `%0A%0A*To pay:* ₹${grandTotal}`;

  if (shareBtn) shareBtn.href = `https://api.whatsapp.com/send?phone=918757275722&text=${msg}`;

  // switch to payment step for mobile
  goTo(2);
}

// ------- VERIFY PAYMENT & DELIVER -------
async function verifyPaymentAndDeliver(){
  const txn = (document.getElementById('txnId') || {}).value?.trim() || '';
  const payStatusEl = document.getElementById('payStatus');

  if (!txn) {
    if (payStatusEl) payStatusEl.textContent = 'Please enter a UPI Txn / UTR ID.';
    return;
  }

  // Simple local validation: length & allowed chars (this is minimal)
  if (!/^[A-Za-z0-9\-\/]{6,60}$/.test(txn)) {
    if (payStatusEl) payStatusEl.textContent = 'Txn ID looks invalid. Please check and try.';
    return;
  }

  // Prevent duplicate delivery: if already delivered for same orderId, stop
  if (_deliveredResults && _lastOrderId && _deliveredResults.orderId === _lastOrderId) {
    if (payStatusEl) payStatusEl.textContent = 'Codes already delivered for this order.';
    return;
  }

  // Here you would normally call your server to verify the Txn/UTR and amount.
  // For now: we only check Txn exists and then request codes from Apps Script.
  if (payStatusEl) payStatusEl.textContent = 'Verifying payment...';

  try {
    // OPTIONAL: You may want to call a verification endpoint that checks the Txn ID hasn't been used
    // and that amount matches _lastGrandTotal. That server should return ok:true before we call deliverCodes.
    // For now we proceed to call deliverCodes directly.

    if (!_lastOrderId || !_lastRequests || _lastRequests.length === 0) {
      if (payStatusEl) payStatusEl.textContent = 'No pending order found. Generate order first.';
      return;
    }

    // show a small delay for UX
    await new Promise(r => setTimeout(r, 800));
    if (payStatusEl) payStatusEl.textContent = 'Payment confirmed (local). Fetching codes...';

    const results = await deliverCodes(_lastOrderId, _lastRequests, receiptBody);
    // tag delivered results with orderId for safety
    _deliveredResults = { orderId: _lastOrderId, results };

    if (payStatusEl) payStatusEl.textContent = 'Codes delivered.';

    // switch to delivered step
    goTo(3);

  } catch (err) {
    if (payStatusEl) payStatusEl.textContent = 'Verification or fetch failed: ' + String(err);
  }
}

// ------- small helper goTo (used by mobile stepper script) -------
function goTo(stepNum){
  ['step1','step2','step3'].forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    if (id === `step${stepNum}`) el.classList.add('active');
    else el.classList.remove('active');
  });
  const topEl = document.getElementById(`step${stepNum}`);
  if (topEl) topEl.scrollIntoView({behavior:'smooth', block:'start'});
}

// ------- INIT / wiring -------
renderCoupons();
recalc();

on(applyOfferEl, 'change', ()=>{
  state.offerApplied = !!applyOfferEl.checked;
  recalc();
});

// buttons
on(document.getElementById('makeOrder'), 'click', generateOrder);
on(document.getElementById('verifyPay'), 'click', verifyPaymentAndDeliver);
on(document.getElementById('goPayment'), 'click', ()=> goTo(2));
on(document.getElementById('backToCart'), 'click', ()=> goTo(1));
on(document.getElementById('goDelivered'), 'click', ()=> goTo(3));
on(document.getElementById('backToPay'), 'click', ()=> goTo(2));
on(document.getElementById('clearAll'), 'click', ()=>{
  state.items = {}; state.total = 0; renderCoupons(); recalc();
  document.getElementById('buyerName').value = '';
  document.getElementById('buyerPhone').value = '';
  document.getElementById('buyerNote').value = '';
  if (receiptBody) receiptBody.innerHTML = 'No items yet. Choose coupons and click “Generate order”.';
  document.getElementById('orderStatus').textContent = 'Draft';
  if (shareBtn) shareBtn.href = '#';
});

// expose for debugging
window._debug_state = state;
window._debug_catalog = CATALOG;
window._deliverCodes = deliverCodes;













