// —— State ——
let stays = [];
let viewDate = new Date();
viewDate.setDate(1);
viewDate.setHours(0, 0, 0, 0);
let selectedId = null; // confirmation code or reservation key of the selected stay

const $ = (sel) => document.querySelector(sel);

// —— Country name → ISO 3166-1 alpha-2 → flag emoji ——
const COUNTRY_TO_ISO = {
  'united states': 'US', 'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'france': 'FR', 'germany': 'DE', 'italy': 'IT', 'spain': 'ES', 'portugal': 'PT',
  'netherlands': 'NL', 'belgium': 'BE', 'switzerland': 'CH', 'austria': 'AT',
  'ireland': 'IE', 'denmark': 'DK', 'sweden': 'SE', 'norway': 'NO', 'finland': 'FI',
  'iceland': 'IS', 'poland': 'PL', 'czech republic': 'CZ', 'czechia': 'CZ',
  'hungary': 'HU', 'greece': 'GR', 'turkey': 'TR', 'türkiye': 'TR', 'croatia': 'HR',
  'slovenia': 'SI', 'slovakia': 'SK', 'romania': 'RO', 'bulgaria': 'BG',
  'serbia': 'RS', 'estonia': 'EE', 'latvia': 'LV', 'lithuania': 'LT', 'ukraine': 'UA',
  'russia': 'RU', 'luxembourg': 'LU', 'malta': 'MT', 'cyprus': 'CY',
  'canada': 'CA', 'mexico': 'MX', 'guatemala': 'GT', 'belize': 'BZ',
  'costa rica': 'CR', 'panama': 'PA', 'cuba': 'CU', 'jamaica': 'JM',
  'dominican republic': 'DO', 'puerto rico': 'PR', 'bahamas': 'BS', 'barbados': 'BB',
  'brazil': 'BR', 'argentina': 'AR', 'chile': 'CL', 'peru': 'PE', 'colombia': 'CO',
  'ecuador': 'EC', 'uruguay': 'UY', 'bolivia': 'BO', 'paraguay': 'PY', 'venezuela': 'VE',
  'japan': 'JP', 'china': 'CN', 'south korea': 'KR', 'korea': 'KR', 'taiwan': 'TW',
  'hong kong': 'HK', 'singapore': 'SG', 'thailand': 'TH', 'vietnam': 'VN',
  'philippines': 'PH', 'indonesia': 'ID', 'malaysia': 'MY', 'cambodia': 'KH',
  'laos': 'LA', 'myanmar': 'MM', 'india': 'IN', 'nepal': 'NP', 'sri lanka': 'LK',
  'pakistan': 'PK', 'bangladesh': 'BD',
  'australia': 'AU', 'new zealand': 'NZ', 'fiji': 'FJ',
  'south africa': 'ZA', 'morocco': 'MA', 'egypt': 'EG', 'tunisia': 'TN',
  'kenya': 'KE', 'tanzania': 'TZ', 'nigeria': 'NG', 'ghana': 'GH',
  'ethiopia': 'ET', 'rwanda': 'RW', 'uganda': 'UG', 'senegal': 'SN',
  'united arab emirates': 'AE', 'uae': 'AE', 'israel': 'IL', 'jordan': 'JO',
  'saudi arabia': 'SA', 'qatar': 'QA', 'oman': 'OM', 'lebanon': 'LB',
  'georgia': 'GE', 'armenia': 'AM', 'azerbaijan': 'AZ',
};
function isoToFlag(iso) {
  if (!iso || iso.length !== 2) return '';
  const A = 0x1f1e6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(...[...iso.toUpperCase()].map(c => c.charCodeAt(0) + A));
}
function countryFromAddress(address) {
  if (!address) return null;
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1]?.toLowerCase().replace(/\s+/g, ' ');
  return last ? (COUNTRY_TO_ISO[last] ?? null) : null;
}
function flagFor(stay) {
  const iso = countryFromAddress(stay.location?.oneLineAddress);
  return iso ? isoToFlag(iso) : '';
}

// —— Date helpers ——
function diffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// —— Identity helper ——
// Stable key for matching the selected stay across re-renders.
function stayKey(s) {
  return s.confirmationCode || s.id || s.reservationKey;
}

// —— Data fetch ——
async function loadTrips() {
  setStatus('Loading…');
  const tabs = await chrome.tabs.query({ url: 'https://www.airbnb.com/*' });
  if (!tabs.length) {
    setStatus('Open airbnb.com in a tab (and sign in) so the extension can fetch your trips.', 'error');
    return;
  }
  const tab = tabs.find((t) => t.url?.includes('/trips')) ?? tabs[0];
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TRIPS' });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Unknown error');
    stays = reply.stays;
    setStatus(stays.length ? '' : 'No upcoming trips.');
    // Default selection: the trip happening now, or the next upcoming.
    selectedId = stayKey(pickDefaultStay(stays));
    render();
    renderDetails();
  } catch (err) {
    setStatus(
      `Couldn't reach the page. Try reloading your airbnb.com tab. (${err.message})`,
      'error'
    );
  }
}

function pickDefaultStay(stays) {
  if (!stays.length) return null;
  const now = Date.now();
  // First: a trip currently in progress (start ≤ now ≤ end).
  const inProgress = stays.find((s) => {
    const start = new Date(s.startTime).getTime();
    const end = new Date(s.endTime).getTime();
    return start <= now && end >= now;
  });
  if (inProgress) return inProgress;
  // Otherwise: the next-starting future trip.
  const upcoming = stays
    .filter((s) => new Date(s.startTime).getTime() > now)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  if (upcoming.length) return upcoming[0];
  // Fallback: just the first one.
  return stays[0];
}

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

// —— Bar layout ——
function staysWithLocalDates() {
  return stays.map((s, i) => ({
    ...s,
    _idx: i,
    _start: startOfDay(new Date(s.startTime)),
    _end: startOfDay(new Date(s.endTime)),
    _nights: Math.max(
      1,
      diffDays(startOfDay(new Date(s.startTime)), startOfDay(new Date(s.endTime)))
    ),
    _flag: flagFor(s),
    _key: stayKey(s),
  }));
}
function assignRows(items) {
  const sorted = [...items].sort((a, b) => a._start - b._start);
  const rowEnds = [];
  for (const item of sorted) {
    let placed = false;
    for (let r = 0; r < rowEnds.length; r++) {
      if (rowEnds[r] < item._start) {
        item._row = r;
        rowEnds[r] = item._end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item._row = rowEnds.length;
      rowEnds.push(item._end);
    }
  }
  return sorted;
}

// —— Calendar render ——
function render() {
  $('#month-title').textContent =
    `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  const firstOfMonth = new Date(viewDate);
  const lastOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const today = startOfDay(new Date());
  const totalDays = diffDays(gridStart, gridEnd) + 1;
  const numWeeks = totalDays / 7;

  const all = assignRows(
    staysWithLocalDates().filter(
      (s) => s._end >= gridStart && s._start <= gridEnd
    )
  );

  // Body-level class lets CSS dim non-selected bars.
  document.body.classList.toggle('has-selection', !!selectedId);

  const cal = $('#calendar');
  cal.innerHTML = '';

  const wRow = document.createElement('div');
  wRow.className = 'weekday-row';
  for (const w of WEEKDAYS) {
    const wd = document.createElement('div');
    wd.className = 'weekday';
    wd.textContent = w;
    wRow.appendChild(wd);
  }
  cal.appendChild(wRow);

  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(gridStart);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekRow = document.createElement('div');
    weekRow.className = 'week-row';

    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + d);
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      if (day.getMonth() !== viewDate.getMonth()) cell.classList.add('other-month');
      if (day.getTime() === today.getTime()) cell.classList.add('today');
      const num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = day.getDate();
      cell.appendChild(num);
      weekRow.appendChild(cell);
    }

    const layer = document.createElement('div');
    layer.className = 'bars-layer';

    const weekStays = all.filter(
      (s) => s._end >= weekStart && s._start <= weekEnd
    );
    let maxRowThisWeek = -1;
    for (const s of weekStays) maxRowThisWeek = Math.max(maxRowThisWeek, s._row);
    const rowsNeeded = maxRowThisWeek + 1;
    const minH = 22 + rowsNeeded * (18 + 2) + 4;
    weekRow.style.minHeight = `${Math.max(64, minH)}px`;

    for (const s of weekStays) {
      const barStart = s._start < weekStart ? weekStart : s._start;
      const barEnd = s._end > weekEnd ? weekEnd : s._end;
      const startCol = diffDays(weekStart, barStart);
      const endCol = diffDays(weekStart, barEnd);
      const span = endCol - startCol + 1;

      const bar = document.createElement('button');
      bar.className = 'bar';
      const colorIdx = (s._idx % 8) + 1;
      bar.style.background = `var(--bar-${colorIdx})`;
      const leftPct = (startCol / 7) * 100;
      const widthPct = (span / 7) * 100;
      bar.style.left = `calc(${leftPct}% + 2px)`;
      bar.style.width = `calc(${widthPct}% - 4px)`;
      bar.style.top = `${s._row * (18 + 2)}px`;

      if (s._start < weekStart) bar.classList.add('continues-left');
      if (s._end > weekEnd) bar.classList.add('continues-right');
      if (s.status === 'PENDING') bar.classList.add('pending');
      if (s._key === selectedId) bar.classList.add('selected');

      const label = s.tripDisplayName || s.location.city || 'Trip';
      const flag = s._flag ? `<span class="bar-flag">${s._flag}</span>` : '';
      const meta = `<span class="bar-meta">${s._nights}n</span>`;
      bar.innerHTML = `${flag}${escapeHtml(label)}${meta}`;

      bar.addEventListener('click', () => selectStay(s._key));
      layer.appendChild(bar);
    }

    weekRow.appendChild(layer);
    cal.appendChild(weekRow);
  }
}

// —— Details panel ——
function selectStay(key) {
  selectedId = key;
  render();
  renderDetails();
  // Make sure the selected trip is visible — if the user clicked a bar
  // continuing from another month, that month is still in view.
  // No scroll needed beyond that.
}

function renderDetails() {
  const wrap = $('#details');
  if (!stays.length) {
    wrap.innerHTML = '';
    return;
  }
  const s = stays.find((x) => stayKey(x) === selectedId);
  if (!s) {
    wrap.innerHTML = `<div class="details-empty">Select a trip to see details.</div>`;
    return;
  }

  const destFmt = (iso, opts) =>
    new Date(iso).toLocaleString('en-US', { timeZone: s.timeZone, ...opts });
  const dayOf = (iso) => destFmt(iso, { day: 'numeric' });
  const monthYrOf = (iso) => destFmt(iso, { month: 'short', year: 'numeric' });
  const timeOf = (iso) => destFmt(iso, { hour: 'numeric', minute: '2-digit' });
  const weekdayOf = (iso) =>
    new Date(iso).toLocaleString('en-US', { timeZone: s.timeZone, weekday: 'short' });

  const title = s.tripDisplayName || s.location.city || 'Trip';
  const flag = flagFor(s);
  const nights = Math.max(
    1,
    diffDays(startOfDay(new Date(s.startTime)), startOfDay(new Date(s.endTime)))
  );
  const url = reservationUrl(s);

  wrap.innerHTML = `
    <div class="details-hero">
      ${s.listing.imageUri ? `<img src="${escapeAttr(s.listing.imageUri)}" alt="" />` : ''}
      ${s.status ? `<span class="details-status ${s.status === 'PENDING' ? 'pending' : ''}">${escapeHtml(s.status)}</span>` : ''}
    </div>
    <div class="details-body">
      <div class="details-title-row">
        <h2 class="details-title">
          ${flag ? `<span class="details-flag">${flag}</span>` : ''}${escapeHtml(title)}
        </h2>
      </div>
      <p class="details-subtitle">${escapeHtml(s.listing.propertyTypeLabel || '')}</p>

      <div class="details-dates">
        <div class="details-date">
          <div class="label">${escapeHtml(weekdayOf(s.startTime))} · Check-in</div>
          <div class="day">${escapeHtml(dayOf(s.startTime))}</div>
          <div class="month-yr">${escapeHtml(monthYrOf(s.startTime))}</div>
          <div class="time">${escapeHtml(timeOf(s.startTime))}</div>
        </div>
        <div class="details-arrow">→</div>
        <div class="details-date">
          <div class="label">${escapeHtml(weekdayOf(s.endTime))} · Check-out</div>
          <div class="day">${escapeHtml(dayOf(s.endTime))}</div>
          <div class="month-yr">${escapeHtml(monthYrOf(s.endTime))}</div>
          <div class="time">${escapeHtml(timeOf(s.endTime))}</div>
        </div>
      </div>
      <div class="details-duration">${nights} night${nights === 1 ? '' : 's'} · ${escapeHtml(s.timeZone || '')}</div>

      <dl class="details-rows">
        ${s.location.multiLineAddress ? `
          <dt>Address</dt>
          <dd><a class="details-link" href="${escapeAttr(mapsUrl(s))}" target="_blank" rel="noopener">${s.location.multiLineAddress.map(escapeHtml).join('<br>')}</a></dd>
        ` : ''}
        ${s.host?.firstName ? `
          <dt>Host</dt>
          <dd>${escapeHtml(s.host.firstName)}</dd>
        ` : ''}
        ${s.guests?.numAdults ? `
          <dt>Guests</dt>
          <dd>${s.guests.numAdults} adult${s.guests.numAdults === 1 ? '' : 's'}</dd>
        ` : ''}
      </dl>

      ${url ? `
        <div class="details-actions">
          <a class="btn" href="${escapeAttr(url)}" target="_blank" rel="noopener">Open in a new tab ↗</a>
        </div>
      ` : ''}
    </div>
  `;
}

function reservationUrl(s) {
  if (s.reservationKey) {
    return `https://www.airbnb.com/trips/v1/reservation-details/ro/${s.reservationKey}`;
  }
  if (s.confirmationCode) {
    return `https://www.airbnb.com/trips/v1/reservation-details/ro/RESERVATION2_CHECKIN/${s.confirmationCode}`;
  }
  return null;
}

// Google Maps search URL for the listing address.
// Uses the single-line address as the search query — Google handles fuzzy
// matching well, so this works even for non-US-formatted addresses.
function mapsUrl(s) {
  const q = s.location?.oneLineAddress
    || s.location?.multiLineAddress?.join(', ')
    || s.location?.city
    || '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// —— Escape helpers ——
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// —— Wiring ——
$('#prev-month').addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() - 1);
  render();
});
$('#next-month').addEventListener('click', () => {
  viewDate.setMonth(viewDate.getMonth() + 1);
  render();
});
$('#today-btn').addEventListener('click', () => {
  viewDate = new Date();
  viewDate.setDate(1);
  viewDate.setHours(0, 0, 0, 0);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') $('#prev-month').click();
  if (e.key === 'ArrowRight') $('#next-month').click();
});

// —— Initial ——
render();
renderDetails();
loadTrips();
