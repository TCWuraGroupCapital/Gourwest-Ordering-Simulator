/** Flagship kitchens shown on the globe, the store picker and the locations page (synthetic demo data). */

/** The seven region codes Luminara CRM accepts on the online_ordering webhook. */
export const CRM_REGIONS = ['AU', 'NZ', 'SG', 'MY', 'TH', 'UK', 'CA'] as const;
export type RegionCode = (typeof CRM_REGIONS)[number];

export interface Store {
  id: string;
  name: string;
  city: string;
  country: string;
  region: RegionCode;
  address: string;
  lat: number;
  lon: number;
  timeZone: string;
  /** 24h local opening hours, "HH:MM". */
  opens: string;
  closes: string;
  prepMinutes: number;
}

export const STORES: Store[] = [
  {
    id: 'melbourne-central',
    name: 'Melbourne Central',
    city: 'Melbourne',
    country: 'Australia',
    region: 'AU',
    address: 'Level 1 Food Hall, 211 La Trobe St, Melbourne VIC 3000',
    lat: -37.8102,
    lon: 144.9628,
    timeZone: 'Australia/Melbourne',
    opens: '10:30',
    closes: '21:30',
    prepMinutes: 15,
  },
  {
    id: 'southbank',
    name: 'Southbank Promenade',
    city: 'Melbourne',
    country: 'Australia',
    region: 'AU',
    address: 'Shop 4, Riverside Quay, Southbank VIC 3006',
    lat: -37.8205,
    lon: 144.9595,
    timeZone: 'Australia/Melbourne',
    opens: '11:00',
    closes: '22:00',
    prepMinutes: 15,
  },
  {
    id: 'auckland-commercial-bay',
    name: 'Commercial Bay',
    city: 'Auckland',
    country: 'New Zealand',
    region: 'NZ',
    address: 'Level 2, 7 Queen Street, Auckland 1010',
    lat: -36.8441,
    lon: 174.7676,
    timeZone: 'Pacific/Auckland',
    opens: '10:30',
    closes: '21:00',
    prepMinutes: 15,
  },
  {
    id: 'singapore-orchard',
    name: 'Orchard Gateway',
    city: 'Singapore',
    country: 'Singapore',
    region: 'SG',
    address: '#B1-08, 277 Orchard Road, Singapore 238858',
    lat: 1.3006,
    lon: 103.8395,
    timeZone: 'Asia/Singapore',
    opens: '11:00',
    closes: '22:00',
    prepMinutes: 15,
  },
  {
    id: 'kuala-lumpur-klcc',
    name: 'Suria KLCC',
    city: 'Kuala Lumpur',
    country: 'Malaysia',
    region: 'MY',
    address: 'Concourse Level, Suria KLCC, 50088 Kuala Lumpur',
    lat: 3.1579,
    lon: 101.7123,
    timeZone: 'Asia/Kuala_Lumpur',
    opens: '10:00',
    closes: '22:00',
    prepMinutes: 15,
  },
];

export const DEFAULT_STORE_ID = STORES[0].id;

export function findStore(id: string): Store | undefined {
  return STORES.find((store) => store.id === id);
}

/** Minutes since local midnight in the store's own time zone. */
function localMinutes(store: Store, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: store.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isOpen(store: Store, now = new Date()): boolean {
  const t = localMinutes(store, now);
  return t >= toMinutes(store.opens) && t < toMinutes(store.closes);
}

export function formatHours(store: Store): string {
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`;
  };
  return `${fmt(store.opens)}–${fmt(store.closes)}`;
}
