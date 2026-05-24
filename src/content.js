// Runs on airbnb.com — has access to session cookies and the SSR'd data blob.
// Receives messages from the side panel; replies with trip data.

// DEMO_MODE: when true, returns fixture data instead of making any network calls.
// Use this for screenshots and local development without touching real data.
const DEMO_MODE = false;

const OPERATION_ID =
  'abaf27d65afa3e3fc0857cc28a7c62cccaf75273d158d35dba27c5622b362890';

// Recursive search helper.
function findAll(obj, predicate, results = []) {
  if (obj && typeof obj === 'object') {
    if (predicate(obj)) results.push(obj);
    for (const key in obj) findAll(obj[key], predicate, results);
  }
  return results;
}

// Pull the current user ID. Strategy: a regex against the page HTML for the
// stable "subject":"user","subjectId":"<digits>" pattern that appears in
// logging/telemetry data on every authenticated page.
function getUserId() {
  const html = document.documentElement.outerHTML;
  const m = html.match(/"subject"\s*:\s*"user"\s*,\s*"subjectId"\s*:\s*"(\d+)"/);
  if (m) return btoa(`User:${m[1]}`);

  // Fallback: walk the SSR'd blob for a User node with an explicit id.
  const el = document.getElementById('data-injector-instances');
  if (el) {
    let blob;
    try { blob = JSON.parse(el.textContent); } catch { blob = null; }
    if (blob) {
      const users = findAll(
        blob,
        (o) => o.__typename === 'User' && typeof o.id === 'string'
      );
      const viewer = users.find((u) => u.presentation || u.email) || users[0];
      if (viewer?.id) return viewer.id;
    }
  }

  // Last resort: any base64-encoded User: ID in the HTML.
  const idMatch = html.match(/"(VXNlcjo[A-Za-z0-9+/=]+)"/);
  if (idMatch) return idMatch[1];

  return null;
}

// Pull the public API key from the page HTML. The key is embedded in inline
// JS on every page; we look for the standard 32-char lowercase alphanumeric
// pattern in known field names.
function getApiKey() {
  const html = document.documentElement.outerHTML;
  const patterns = [
    /"api_config"\s*:\s*\{\s*"key"\s*:\s*"([a-z0-9]{32})"/,
    /"X-Airbnb-API-Key"\s*:\s*"([a-z0-9]{32})"/,
    /"key"\s*:\s*"([a-z0-9]{32})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

// Build the GraphQL persisted-query URL.
function buildUrl(variables) {
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: OPERATION_ID },
  };
  const params = new URLSearchParams({
    operationName: 'TripsTabQuery',
    locale: 'en',
    currency: 'USD',
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  });
  return `https://www.airbnb.com/api/v3/TripsTabQuery/${OPERATION_ID}?${params}`;
}

async function fetchPage({ userId, after, first = 10, apiKey }) {
  const variables = {
    userId,
    first,
    includeHotelFragments: true,
    ...(after ? { after } : {}),
  };
  const res = await fetch(buildUrl(variables), {
    headers: {
      'X-Airbnb-API-Key': apiKey,
      'X-Airbnb-GraphQL-Platform': 'web',
      'X-Airbnb-GraphQL-Platform-Client': 'minimalist-niobe',
    },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const json = await res.json();
  const conn = json?.data?.node?.trips;
  if (!conn) throw new Error('Unexpected response shape');
  return conn;
}

async function fetchAllTrips() {
  const userId = getUserId();
  if (!userId) throw new Error('Could not identify the current user — are you signed in?');
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Could not read the public API key from the page. Try reloading.');

  const allEdges = [];
  let after = null;
  let safety = 20;

  while (safety-- > 0) {
    const conn = await fetchPage({ userId, after, apiKey });
    allEdges.push(...(conn.edges ?? []));
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return allEdges;
}

// Normalize response into flat stay items.
function extractStays(edges) {
  const stays = [];
  for (const edge of edges) {
    const trip = edge?.node;
    if (!trip?.items) continue;
    for (const item of trip.items) {
      if (item.__typename !== 'StayReservationTripItem') continue;
      const r = item.stayReservation;
      const status = r?.guestFacingStatus;
      if (status === 'CANCELED') continue;

      stays.push({
        id: r?.confirmationCode ?? item.reservationKey,
        confirmationCode: r?.confirmationCode,
        reservationKey: item.reservationKey,
        tripDisplayName: trip.displayName,
        startTime: item.startTime,
        endTime: item.endTime,
        timeZone: item.timeZone,
        status,
        location: {
          city: r?.supplyListing?.demandListing?.location?.city,
          oneLineAddress: item.guestFacingLocation?.oneLineAddress,
          multiLineAddress: item.guestFacingLocation?.multiLineAddress,
        },
        listing: {
          propertyTypeLabel:
            r?.supplyListing?.propertyTypes?.propertyTypeLabel,
          imageUri: r?.supplyListing?.media?.defaultMediaEntity?.uri,
        },
        host: { firstName: r?.primaryHost?.displayFirstName },
        guests: { numAdults: r?.guestCountDetails?.numberOfAdults },
      });
    }
  }
  return stays;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'GET_TRIPS') return;

  if (DEMO_MODE) {
    sendResponse({ ok: true, stays: DEMO_STAYS });
    return;
  }

  fetchAllTrips()
    .then((edges) => sendResponse({ ok: true, stays: extractStays(edges) }))
    .catch((err) =>
      sendResponse({ ok: false, error: err?.message ?? String(err) })
    );

  return true;
});

// ——————————————————————————————————————————————————————————————————————————
// DEMO FIXTURES — used only when DEMO_MODE is true.
// ——————————————————————————————————————————————————————————————————————————

const DEMO_STAYS = [
  {
    id: 'DEMOLISBON',
    confirmationCode: 'DEMOLISBON',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOLISBON',
    tripDisplayName: 'Lisbon',
    startTime: '2026-06-12T14:00:00.000Z',
    endTime: '2026-06-16T10:00:00.000Z',
    timeZone: 'Europe/Lisbon',
    status: 'ACCEPTED',
    location: {
      city: 'Lisbon',
      oneLineAddress: 'Rua da Bica de Duarte Belo 47, Lisbon, Portugal',
      multiLineAddress: ['Rua da Bica de Duarte Belo 47', 'Lisbon, 1200-091, Portugal'],
    },
    listing: {
      propertyTypeLabel: 'Apartment',
      imageUri: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'Mariana' },
    guests: { numAdults: 2 },
  },
  {
    id: 'DEMOPORTO0',
    confirmationCode: 'DEMOPORTO0',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOPORTO0',
    tripDisplayName: 'Porto',
    startTime: '2026-06-16T15:00:00.000Z',
    endTime: '2026-06-19T11:00:00.000Z',
    timeZone: 'Europe/Lisbon',
    status: 'ACCEPTED',
    location: {
      city: 'Porto',
      oneLineAddress: 'Rua das Flores 168, Porto, Portugal',
      multiLineAddress: ['Rua das Flores 168', 'Porto, 4050-263, Portugal'],
    },
    listing: {
      propertyTypeLabel: 'Loft',
      imageUri: 'https://plus.unsplash.com/premium_photo-1677344087971-91eee10dfeb1?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'João' },
    guests: { numAdults: 2 },
  },
  {
    id: 'DEMOCDMX00',
    confirmationCode: 'DEMOCDMX00',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOCDMX00',
    tripDisplayName: 'Mexico City',
    startTime: '2026-07-04T16:00:00.000Z',
    endTime: '2026-07-10T11:00:00.000Z',
    timeZone: 'America/Mexico_City',
    status: 'ACCEPTED',
    location: {
      city: 'Mexico City',
      oneLineAddress: 'Calle Orizaba 116, Roma Norte, Mexico City, Mexico',
      multiLineAddress: ['Calle Orizaba 116, Roma Norte', 'Mexico City, CDMX 06700, Mexico'],
    },
    listing: {
      propertyTypeLabel: 'Apartment',
      imageUri: 'https://plus.unsplash.com/premium_photo-1697729800872-866107ce82c4?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'Sofía' },
    guests: { numAdults: 1 },
  },
  {
    id: 'DEMOTOKYO0',
    confirmationCode: 'DEMOTOKYO0',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOTOKYO0',
    tripDisplayName: 'Tokyo',
    startTime: '2026-07-28T06:00:00.000Z',
    endTime: '2026-08-05T01:00:00.000Z',
    timeZone: 'Asia/Tokyo',
    status: 'ACCEPTED',
    location: {
      city: 'Tokyo',
      oneLineAddress: '2-7-3 Jingumae, Shibuya City, Tokyo, Japan',
      multiLineAddress: ['2-7-3 Jingumae, Shibuya City', 'Tokyo 150-0001, Japan'],
    },
    listing: {
      propertyTypeLabel: 'Apartment',
      imageUri: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'Haruki' },
    guests: { numAdults: 2 },
  },
  {
    id: 'DEMOREYK00',
    confirmationCode: 'DEMOREYK00',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOREYK00',
    tripDisplayName: 'Reykjavík',
    startTime: '2026-08-22T15:00:00.000Z',
    endTime: '2026-08-25T11:00:00.000Z',
    timeZone: 'Atlantic/Reykjavik',
    status: 'PENDING',
    location: {
      city: 'Reykjavík',
      oneLineAddress: 'Laugavegur 22, Reykjavík, Iceland',
      multiLineAddress: ['Laugavegur 22', 'Reykjavík 101, Iceland'],
    },
    listing: {
      propertyTypeLabel: 'Cabin',
      imageUri: 'https://images.unsplash.com/photo-1608468716860-5566b7671ea3?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'Björn' },
    guests: { numAdults: 2 },
  },
  {
    id: 'DEMOMARRA0',
    confirmationCode: 'DEMOMARRA0',
    reservationKey: 'RESERVATION2_CHECKIN/DEMOMARRA0',
    tripDisplayName: 'Marrakech',
    startTime: '2026-09-03T15:00:00.000Z',
    endTime: '2026-09-07T11:00:00.000Z',
    timeZone: 'Africa/Casablanca',
    status: 'ACCEPTED',
    location: {
      city: 'Marrakech',
      oneLineAddress: 'Derb Sidi Bouloukate 41, Medina, Marrakech, Morocco',
      multiLineAddress: ['Derb Sidi Bouloukate 41, Medina', 'Marrakech 40000, Morocco'],
    },
    listing: {
      propertyTypeLabel: 'Riad',
      imageUri: 'https://images.unsplash.com/photo-1587974928442-77dc3e0dba72?q=80&w=1200&auto=format&fit=crop',
    },
    host: { firstName: 'Yasmine' },
    guests: { numAdults: 2 },
  },
];
