import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export type Hemisphere = 'northern' | 'southern';

export interface SeasonWindow {
  name: 'Winter' | 'Spring' | 'Summer' | 'Autumn';
  start: string; // ISO date
  end: string; // ISO date
}

export interface HolidayItem {
  name: string;
  date: string; // ISO date
  localName?: string;
}

export interface SeasonalityContext {
  hemisphere: Hemisphere;
  seasons: SeasonWindow[];
  holidays: HolidayItem[];
}

// Minimal mapping to guess hemisphere from IANA timezone (best‑effort; brand.countryCode preferred)
function guessHemisphereFromTimezone(tz?: string | null): Hemisphere {
  const z = (tz || '').toLowerCase();
  const southernHints = [
    'australia/',
    'pacific/auckland',
    'pacific/chatham',
    'pacific/fiji',
    'america/sao_paulo',
    'america/argentina',
    'america/montevideo',
    'america/santiago',
    'america/asuncion',
    'africa/johannesburg',
    'indian/mauritius',
    'indian/reunion',
  ];
  return southernHints.some((h) => z.includes(h)) ? 'southern' : 'northern';
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function seasonNameForMonth(hemisphere: Hemisphere, monthIndex0: number): SeasonWindow['name'] {
  // monthIndex0: 0=Jan .. 11=Dec
  if (hemisphere === 'northern') {
    if ([11, 0, 1].includes(monthIndex0)) return 'Winter';
    if ([2, 3, 4].includes(monthIndex0)) return 'Spring';
    if ([5, 6, 7].includes(monthIndex0)) return 'Summer';
    return 'Autumn';
  }
  // southern hemisphere seasons flipped by 6 months
  if ([11, 0, 1].includes(monthIndex0)) return 'Summer';
  if ([2, 3, 4].includes(monthIndex0)) return 'Autumn';
  if ([5, 6, 7].includes(monthIndex0)) return 'Winter';
  return 'Spring';
}

function computeSeasonWindows(start: Date, end: Date, hemisphere: Hemisphere): SeasonWindow[] {
  const windows: SeasonWindow[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUTC = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  function endOfSeason(d: Date): Date {
    // Rough season boundaries by month triplets
    const m = d.getUTCMonth();
    let lastMonth: number;
    if (hemisphere === 'northern') {
      if ([11, 0, 1].includes(m))
        lastMonth = 1; // Winter ends Feb
      else if ([2, 3, 4].includes(m))
        lastMonth = 4; // Spring ends May
      else if ([5, 6, 7].includes(m))
        lastMonth = 7; // Summer ends Aug
      else lastMonth = 10; // Autumn ends Nov
    } else {
      if ([11, 0, 1].includes(m))
        lastMonth = 1; // Summer ends Feb
      else if ([2, 3, 4].includes(m))
        lastMonth = 4; // Autumn ends May
      else if ([5, 6, 7].includes(m))
        lastMonth = 7; // Winter ends Aug
      else lastMonth = 10; // Spring ends Nov
    }
    return new Date(Date.UTC(d.getUTCFullYear(), lastMonth + 1, 0)); // last day of lastMonth
  }

  while (cur <= endUTC) {
    const name = seasonNameForMonth(hemisphere, cur.getUTCMonth());
    const sStart = new Date(cur);
    const sEnd = endOfSeason(cur);
    const winStart = sStart < start ? start : sStart;
    const winEnd = sEnd > end ? end : sEnd;
    windows.push({ name, start: toISODate(winStart), end: toISODate(winEnd) });
    // Move to next day after season end
    cur.setUTCFullYear(sEnd.getUTCFullYear());
    cur.setUTCMonth(sEnd.getUTCMonth());
    cur.setUTCDate(sEnd.getUTCDate() + 1);
  }
  return windows;
}

async function tryFetchHolidays(
  countryCode: string | undefined | null,
  years: number[]
): Promise<HolidayItem[]> {
  if (!countryCode) return [];
  try {
    // Lazy import so build doesn’t fail without dependency

    const HolidaysMod = (await import('date-holidays')) as unknown;
    const HolidaysCtor = (HolidaysMod as any).default ?? (HolidaysMod as any);
    const hd = new (HolidaysCtor as any)(countryCode);
    const items: HolidayItem[] = [];
    for (const y of years) {
      const list = hd.getHolidays(y) as Array<{
        name: string;
        date: string;
        start?: Date;
        end?: Date;
        rule?: string;
        _local?: string;
        localName?: string;
      }>;
      for (const h of list) {
        items.push({ name: h.name, date: h.date, localName: h.localName || h._local });
      }
    }
    return items;
  } catch {
    return [];
  }
}

// Minimal tz→country mapping for common cases (best‑effort)
const tzToCountry: Record<string, string> = {
  'america/los_angeles': 'US',
  'america/new_york': 'US',
  'europe/london': 'GB',
  'europe/paris': 'FR',
  'europe/berlin': 'DE',
  'asia/tokyo': 'JP',
  'asia/singapore': 'SG',
  'asia/kolkata': 'IN',
  'australia/sydney': 'AU',
  'pacific/auckland': 'NZ',
  'america/toronto': 'CA',
  'america/sao_paulo': 'BR',
  'africa/johannesburg': 'ZA',
};

function guessCountryFromTimezone(tz?: string | null): string | undefined {
  if (!tz) return undefined;
  return tzToCountry[tz.toLowerCase()] || undefined;
}

export class SeasonalityService {
  static async getSeasonalityForCampaign(campaignId: string): Promise<SeasonalityContext> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { brand: true },
    });
    if (!campaign) {
      return { hemisphere: 'northern', seasons: [], holidays: [] };
    }
    const config = (campaign.config ?? {}) as { duration?: { start?: string; end?: string } };
    const startStr = config.duration?.start;
    const endStr = config.duration?.end;
    const start = startStr ? new Date(startStr) : new Date();
    const end = endStr ? new Date(endStr) : new Date(start.getTime() + 30 * 24 * 3600 * 1000);

    const brand = campaign.brand as {
      postingTimezone?: string | null;
      countryCode?: string | null;
    };
    const hemisphere = guessHemisphereFromTimezone(brand.postingTimezone);
    const seasons = computeSeasonWindows(start, end, hemisphere);

    // Prefer explicit brand.countryCode if present; else best‑effort tz mapping
    const countryCode = brand.countryCode || guessCountryFromTimezone(brand.postingTimezone);
    const years = Array.from(new Set([start.getUTCFullYear(), end.getUTCFullYear()]));
    const allHolidays = await tryFetchHolidays(countryCode, years);
    // Filter holidays to fall within range
    const holidays = allHolidays.filter((h) => {
      const d = new Date(h.date);
      return d >= start && d <= end;
    });

    return { hemisphere, seasons, holidays };
  }
}
