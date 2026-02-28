import type { InstagramAudienceDemographics } from './instagram.js';

export type BreakdownDimension = 'age' | 'gender' | 'country' | 'city';

function extractRawDemographicValue(row: any): unknown {
  return row?.values?.[0]?.value ?? row?.total_value?.value ?? row?.value ?? null;
}

function readDimensionKeys(breakdown: any): string[] {
  if (!Array.isArray(breakdown?.dimension_keys)) {
    return [];
  }
  return breakdown.dimension_keys.map((key: unknown) => String(key));
}

function readDimensionIndex(breakdown: any, breakdownDimension: BreakdownDimension): number {
  return readDimensionKeys(breakdown).indexOf(breakdownDimension);
}

function parseBreakdownResult(
  result: any,
  dimensionIndex: number
): { key: string; value: number } | null {
  const values: unknown[] = Array.isArray(result?.dimension_values) ? result.dimension_values : [];
  const rawKey = values[dimensionIndex];
  const key = typeof rawKey === 'string' ? rawKey : String(rawKey ?? '');
  const value = Number(result?.value);
  if (!key || !isFinite(value) || isNaN(value) || value <= 0) {
    return null;
  }
  return { key, value };
}

function parseBreakdownDimensionMap(
  row: any,
  breakdownDimension: BreakdownDimension
): Record<string, number> | null {
  const breakdowns = row?.total_value?.breakdowns;
  if (!Array.isArray(breakdowns)) {
    return null;
  }

  const map: Record<string, number> = {};
  for (const breakdown of breakdowns) {
    const dimensionIndex = readDimensionIndex(breakdown, breakdownDimension);
    if (dimensionIndex < 0) {
      continue;
    }

    const results: any[] = Array.isArray(breakdown?.results) ? breakdown.results : [];
    for (const result of results) {
      const parsed = parseBreakdownResult(result, dimensionIndex);
      if (!parsed) {
        continue;
      }
      map[parsed.key] = (map[parsed.key] || 0) + parsed.value;
    }
  }
  return map;
}

export function parseDemographicBreakdownRows(
  rows: any[],
  breakdownDimension: BreakdownDimension
): Record<string, number> {
  const row = rows.find((entry) => entry?.name === 'follower_demographics') || rows[0];
  const breakdownMap = parseBreakdownDimensionMap(row, breakdownDimension);
  if (breakdownMap) {
    return breakdownMap;
  }

  const raw = extractRawDemographicValue(row);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const fallback: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(value);
    if (!key || !isFinite(num) || isNaN(num) || num <= 0) {
      continue;
    }
    fallback[key] = (fallback[key] || 0) + num;
  }
  return fallback;
}

function toTopList<T extends string>(
  map: Record<string, number>,
  keyName: T,
  limit: number
): Array<Record<T, string> & { value: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ [keyName]: key, value }) as Record<T, string> & { value: number });
}

function normalizeGenderKey(key: string): 'M' | 'F' | 'U' {
  if (key === 'M' || /^m(ale)?$/i.test(key)) {
    return 'M';
  }
  if (key === 'F' || /^f(emale)?$/i.test(key)) {
    return 'F';
  }
  return 'U';
}

function accumulateGenderTotals(
  genderMap: Record<string, number>
): Record<'M' | 'F' | 'U', number> {
  const totals: Record<'M' | 'F' | 'U', number> = { M: 0, F: 0, U: 0 };
  for (const [key, value] of Object.entries(genderMap)) {
    totals[normalizeGenderKey(key)] += Number(value) || 0;
  }
  return totals;
}

function accumulateAgeTotals(ageMap: Record<string, number>): Map<string, number> {
  const ageTotals = new Map<string, number>();
  for (const [range, value] of Object.entries(ageMap)) {
    const cleaned = String(range || '').trim();
    const num = Number(value);
    if (!cleaned || !isFinite(num) || isNaN(num) || num <= 0) {
      continue;
    }
    ageTotals.set(cleaned, (ageTotals.get(cleaned) || 0) + num);
  }
  return ageTotals;
}

function hasDemographicRows(params: {
  totalAudience: number;
  gender: Array<{ gender: 'M' | 'F' | 'U'; value: number }>;
  age: Array<{ range: string; value: number }>;
  countries: Record<string, number>;
  cities: Record<string, number>;
}): boolean {
  return !(
    params.totalAudience <= 0 &&
    params.gender.length === 0 &&
    params.age.length === 0 &&
    Object.keys(params.countries).length === 0 &&
    Object.keys(params.cities).length === 0
  );
}

export function buildDemographicsFromMaps(
  maps: Map<BreakdownDimension, Record<string, number>>
): InstagramAudienceDemographics | null {
  const genderMap = maps.get('gender') || {};
  const ageMap = maps.get('age') || {};
  const countries = maps.get('country') || {};
  const cities = maps.get('city') || {};

  const genderTotals = accumulateGenderTotals(genderMap);
  const ageTotals = accumulateAgeTotals(ageMap);

  const gender = (Object.entries(genderTotals) as Array<['M' | 'F' | 'U', number]>)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([gender, value]) => ({ gender, value }));
  const age = Array.from(ageTotals.entries())
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([range, value]) => ({ range, value }));

  const totalAudience =
    gender.reduce((sum, entry) => sum + entry.value, 0) ||
    Object.values(countries).reduce((sum, value) => sum + value, 0) ||
    0;

  if (
    !hasDemographicRows({
      totalAudience,
      gender,
      age,
      countries,
      cities,
    })
  ) {
    return null;
  }

  return {
    totalAudience,
    updatedAt: new Date().toISOString(),
    gender,
    age,
    countries: toTopList(countries, 'code', 10),
    cities: toTopList(cities, 'name', 10),
    locales: [],
  };
}
