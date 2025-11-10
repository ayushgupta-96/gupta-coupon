// ---- BACKEND (Google Apps Script) CONFIG ----
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbytsOYztcywQo-7dceAzPlc_XD_CeOc32vXLAunqNnmrqVEog-Nf9c_JuJ5RCsbaA6YfQ/exec";
const SECRET_TOKEN = "Niraj@9631"; // must match the token in Apps Script

// Map our catalog IDs to sheet/tab names
const TYPE_MAP = { F20: "F20", F19: "F19", F17: "F17" };

// ====== 1) CATALOG ======
const CATALOG = [
  { id: 'F20', title: 'Flipkart 20-digit coupon', price: 6, length: 20, stock: 1000 },
  { id: 'F19', title: 'Flipkart 19-digit coupon', price: 6, length: 19, stock: 0 },
  { id: 'F17', title: 'Flipkart 17-digit coupon', price: 6, length: 17, stock: 0 },
];
let proofFile = null; // the uploaded image file (if any)

const uploadBtn = document.getElementById('uploadProof');
const proofInput = document.getElementById('proofInput');
const proofPreview = document.getElementById('proofPreview');
const proofPreviewWrap = document.getElementById('proofPreviewWrap');
const shareBtn = document.getElementById('shareWA');

// Platform fee (flat). Keep 0 if not needed.
const PLATFORM_FEE = 0;

// State + elements
const couponListEl = document.getElementById('couponList');
const state = { items: {}, total: 0 };
// 10% offer config
const OFFER_MIN_QTY = 100;
const OFFER_RATE = 0.10;

// track offer state
state.offerApplied = false;

// offer UI refs
const applyOfferEl   = document.getElementById('applyOffer');
const offerStatusEl  = document.getElementById('offerStatus');
const discountRowEl  = document.getElementById('discountRow');
const discountEl     = document.getElementById('discount');

// toggle by user
applyOfferEl?.addEventListener('change', () => {
  state.offerApplied = applyOfferEl.checked;
  recalc();
});

// ====== 2) RENDER LIST ======
function renderCoupons(){
  couponListEl.innerHTML = '';
  CATALOG.forEach(item => {
    const wrap = document.createElement('div');
    wrap.className = 'coupon' + (item.stock === 0 ? ' oos' : '');

    const stockText = item.stock === 0 ? 'Out of stock' : item.stock;

    const title = document.createElement('div');
    title.innerHTML = `
      <strong>${item.title}</strong>
      <div class="muted">ID: ${item.id} • Length: ${item.length} digits • Stock: ${stockText}</div>
    `;

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

// ====== 3) PRICE SUMMARY ======
function recalc(){
  // subtotal
  const subtotal = Object.entries(state.items).reduce((acc, [id, q]) => {
    const item = CATALOG.find(i => i.id === id);
    const qty = Number(q) || 0;
    return acc + (item ? item.price * qty : 0);
  }, 0);

  // total quantity across all items (mix allowed)
  const totalQty = Object.values(state.items).reduce((a, n) => a + (Number(n) || 0), 0);

  // eligibility
  const eligible = totalQty >= OFFER_MIN_QTY;

  // keep checkbox in sync
  if (applyOfferEl) {
    applyOfferEl.disabled = !eligible;
    if (!eligible) {
      state.offerApplied = false;
      applyOfferEl.checked = false;
    }
  }
  if (offerStatusEl) {
    offerStatusEl.textContent = eligible
      ? (state.offerApplied ? 'Applied' : 'Eligible')
      : 'Not eligible';
  }

  // discount
  const discount = state.offerApplied && eligible ? Math.round(subtotal * OFFER_RATE) : 0;

  // fee and total
  const fee = subtotal > 0 ? PLATFORM_FEE : 0;
  const total = subtotal - discount + fee;

  // UI
  document.getElementById('subtotal').textContent = `₹${subtotal}`;
  document.getElementById('fee').textContent      = `₹${fee}`;
  document.getElementById('total').textContent    = `₹${total}`;

  if (discountRowEl && discountEl) {
    discountRowEl.style.display = discount > 0 ? '' : 'none';
    discountEl.textContent = `–₹${discount}`;
  }

  state.total = total;
}
function jsonpRequest(baseUrl, params) {
  return new Promise((resolve, reject) => {
    const cbName = "cb_" + Math.random().toString(36).slice(2);
    const url = baseUrl + "?" + new URLSearchParams({ ...params, callback: cbName }).toString();

    window[cbName] = (data) => { resolve(data); cleanup(); };
    const s = document.createElement("script");
    s.src = url; s.onerror = () => { reject(new Error("JSONP failed")); cleanup(); };
    document.head.appendChild(s);

    function cleanup(){
      try { delete window[cbName]; } catch {}
      if (s.parentNode) s.parentNode.removeChild(s);
    }
  });
}

// ====== 4) ORDER GENERATION ======
async function generateOrder() {
  const name  = (document.getElementById('buyerName')  || {}).value?.trim()  || '';
  const phone = (document.getElementById('buyerPhone') || {}).value?.trim() || '';
  const note  = (document.getElementById('buyerNote')  || {}).value?.trim() || '';

  if (state.total <= 0) { alert('Please add at least one coupon.'); return; }
  if (phone && !/^\d{10}$/.test(phone)) { alert('Enter a valid 10-digit phone number, or leave it empty.'); return; }

  // Build receipt (left panel)
  // --- compute values again so the receipt matches checkout ---
const subForReceipt = Object.entries(state.items).reduce((acc, [id, q]) => {
  const item = CATALOG.find(i => i.id === id);
  const qty = Number(q) || 0;
  return acc + (item ? item.price * qty : 0);
}, 0);
const totalQtyForReceipt = Object.values(state.items).reduce((a, n) => a + (Number(n) || 0), 0);
const eligibleOffer = totalQtyForReceipt >= OFFER_MIN_QTY;
const discountForReceipt = (state.offerApplied && eligibleOffer) ? Math.round(subForReceipt * OFFER_RATE) : 0;
const feeForReceipt = subForReceipt > 0 ? PLATFORM_FEE : 0;
const grandTotal = subForReceipt - discountForReceipt + feeForReceipt;

  <tfoot>
  <tr>
    <td></td>
    <td style="text-align:right; color: var(--muted);">Fee</td>
    <td style="text-align:right;">₹${feeForReceipt}</td>
  </tr>
  ${discountForReceipt > 0
    ? `<tr><td></td><td style="text-align:right; color: var(--muted);">Discount (10% off)</td><td style="text-align:right;">–₹${discountForReceipt}</td></tr>`
    : ''
  }
  <tr>
    <td></td>
    <td style="text-align:right; font-weight:800;">Total</td>
    <td style="text-align:right; font-weight:800;">₹${grandTotal}</td>
  </tr>
</tfoot>

      </table>
      ${note ? `<div class="divider"></div><div class="muted"><strong>Note:</strong> ${escapeHtml(note)}</div>` : ''}
      <div class="divider"></div>
      <div class="notice">Paid via UPI (UPI: ${document.getElementById('upiId')?.textContent || ''}). Attach payment screenshot when you share.</div>
    `;
  }

  // WhatsApp message
  let msg = `*Coupon Order*%0AOrder ID: ${orderId}%0ATotal: ₹${state.total}%0AItems:%0A` +
    Object.entries(state.items).filter(([_,q])=>q>0)
      .map(([id,q])=>{ const item = CATALOG.find(i=>i.id===id); return `- ${item.title} x ${q}`; })
      .join('%0A');
  if (name)  msg = `*Coupon Order*%0AOrder ID: ${orderId}%0AName: ${encodeURIComponent(name)}%0A` + msg.slice('*Coupon Order*%0A'.length);
  if (phone) msg += `%0APhone: ${phone}`;
  if (note)  msg += `%0ANote: ${encodeURIComponent(note)}`;
  if (discountForReceipt > 0) {
  msg += `%0ADiscount: ₹${discountForReceipt}`;
}

  const shareBtn = document.getElementById('shareWA');
if (shareBtn) shareBtn.href = `https://api.whatsapp.com/send?phone=918757275722&text=${msg}`;


  // ===== Fetch codes from Apps Script for each requested type (JSONP to avoid CORS) =====
  const requests = Object.entries(state.items)
    .filter(([_, q]) => q > 0)
    .map(([id, q]) => ({ type: TYPE_MAP[id], qty: Number(q) }));

  try {
  const results = [];
  // delay codes after whatsapp share clicking
  await new Promise(res => setTimeout(res, 4500));

  for (const r of requests) {
      const data = await jsonpRequest(WEB_APP_URL, {
        token: SECRET_TOKEN,
        type: r.type,
        qty: String(r.qty),
        orderId
      });
      results.push({ req: r, ok: !!data.ok, codes: data.codes || [], error: data.error });
  }


    const blocks = results.map(x => {
      if (!x.ok) return `<div class="notice">(${x.req.type}) ${x.error || 'failed'}</div>`;
      const codesHtml = x.codes.map(c => `<code>${c}</code>`).join('<br>');
      return `<div><strong>${x.req.type} codes</strong><div style="margin-top:4px">${codesHtml}</div></div>`;
    }).join('<div class="divider"></div>');

    if (receiptBody) {
      receiptBody.innerHTML += `
        <div class="divider"></div>
        <div><strong>Delivered codes</strong></div>
        <div style="margin-top:6px">${blocks}</div>
      `;
    }

    // Update local stock numbers
    results.forEach(r => {
      if (r.ok) {
        const cat = CATALOG.find(c => TYPE_MAP[c.id] === r.req.type);
        if (cat) cat.stock = Math.max(0, cat.stock - r.req.qty);
      }
    });
    renderCoupons();

  } catch (err) {
    if (receiptBody) {
      receiptBody.innerHTML += `<div class="divider"></div><div class="notice">Fetch failed: ${escapeHtml(String(err))}</div>`;
    }
  }
}

// Small helper in case it’s not defined above
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
}

// ====== 5) SCREENSHOT / PDF ======
async function downloadReceiptImage(){
  const target = document.getElementById('receipt');
  try {
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: null });
    const link = document.createElement('a');
    link.download = `coupon-order-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (e){ alert('Could not create screenshot. Make sure you are online (for html2canvas).'); }
}
function printAsPdf(){ window.print(); }
function clearAll(){
  state.items = {}; state.total = 0; renderCoupons(); recalc();
  document.getElementById('buyerName').value = '';
  document.getElementById('buyerPhone').value = '';
  document.getElementById('buyerNote').value = '';
  document.getElementById('receiptBody').innerHTML = 'No items yet. Choose coupons and click “Generate order”.';
  document.getElementById('orderStatus').textContent = 'Draft';
  document.getElementById('shareWA').href = '#';
}

// ====== 6) INIT ======
renderCoupons();
recalc();

// safe helpers
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

on(document.getElementById('makeOrder'), 'click', generateOrder);
on(document.getElementById('downloadImg'), 'click', downloadReceiptImage);
on(document.getElementById('printPdf'), 'click', printAsPdf);
on(document.getElementById('clearAll'), 'click', clearAll);

// Upload + preview (only if those elements exist)
on(uploadBtn, 'click', () => proofInput && proofInput.click());

on(proofInput, 'change', () => {
  const f = proofInput.files && proofInput.files[0];
  if (!f) return;
  proofFile = f;
  const url = URL.createObjectURL(f);
  if (proofPreview)     proofPreview.src = url;
  if (proofPreviewWrap) proofPreviewWrap.style.display = 'block';
});

// Share with fallback (attach file only if the browser supports it)
on(shareBtn, 'click', async (e) => {
  const href = shareBtn.getAttribute('href') || '#';
  if (proofFile && navigator.canShare && navigator.canShare({ files: [proofFile] })) {
    e.preventDefault();
    try {
      await navigator.share({
        files: [proofFile],
        title: 'Payment proof',
        text: decodeURIComponent(href.split('text=')[1] || '')
      });
    } catch (_) {
      // user cancelled → open WhatsApp text
      window.open(href, '_blank', 'noopener');
    }
  } else {
    if (proofFile) alert('WhatsApp will open with text; attach the screenshot manually.');
    // default link opens
  }
});

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();



