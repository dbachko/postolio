export type TimezoneRegion = {
  key: string;
  label: string;
  timezones: string[];
};

export type TimezoneOptions = {
  allTimezones: string[];
  regions: TimezoneRegion[];
  timezoneToRegionKey: Record<string, string>;
};

let cachedTimezoneOptionsPromise: Promise<TimezoneOptions> | null = null;

const MULTI_OWNER_PREFERRED_COUNTRY_CODE: Record<string, string> = {
  'America/Creston': 'CA',
  'Europe/Busingen': 'DE',
  'Pacific/Pohnpei': 'FM',
};

type TzdbTimezone = {
  name: string;
  group?: string[];
  countryCode?: string;
  countryName?: string;
};

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function toRegionKey(timezone: TzdbTimezone, fallback: string): string {
  return timezone.countryCode || timezone.countryName || fallback;
}

function toRegionLabel(timezone: TzdbTimezone, fallback: string): string {
  return timezone.countryName || timezone.countryCode || fallback;
}

function addUtcRegion(
  regionsByKey: Map<string, TimezoneRegion>,
  timezoneToRegionKey: Record<string, string>
) {
  const regionKey = 'UTC';
  const region = regionsByKey.get(regionKey) || {
    key: regionKey,
    label: regionKey,
    timezones: [],
  };
  region.timezones.push('UTC');
  regionsByKey.set(regionKey, region);
  timezoneToRegionKey.UTC = regionKey;
}

function resolveOwner(
  timezoneName: string,
  recordByName: Map<string, TzdbTimezone>,
  ownersByMissingTimezone: Map<string, TzdbTimezone[]>
): TzdbTimezone | undefined {
  const directOwner = recordByName.get(timezoneName);
  if (directOwner) {
    return directOwner;
  }
  const owners = ownersByMissingTimezone.get(timezoneName) || [];
  if (owners.length <= 1) {
    return owners[0];
  }
  const preferredCountryCode = MULTI_OWNER_PREFERRED_COUNTRY_CODE[timezoneName];
  return (
    (preferredCountryCode
      ? owners.find((candidate) => candidate.countryCode === preferredCountryCode)
      : undefined) || owners[0]
  );
}

export async function loadTimezoneOptions(): Promise<TimezoneOptions> {
  if (cachedTimezoneOptionsPromise) {
    return cachedTimezoneOptionsPromise;
  }

  cachedTimezoneOptionsPromise = import('@vvo/tzdb').then(({ getTimeZones, timeZonesNames }) => {
    const wantedTimezones = new Set<string>(['UTC', ...timeZonesNames]);
    const records = getTimeZones({ includeUtc: true }) as TzdbTimezone[];
    const recordByName = new Map(records.map((record) => [record.name, record]));

    const missingTimezones = timeZonesNames.filter((tz) => !recordByName.has(tz));
    const missingSet = new Set(missingTimezones);
    const ownersByMissingTimezone = new Map<string, TzdbTimezone[]>();

    for (const record of records) {
      if (!record.group) {
        continue;
      }
      for (const tz of record.group) {
        if (!missingSet.has(tz)) {
          continue;
        }
        const owners = ownersByMissingTimezone.get(tz);
        if (owners) {
          owners.push(record);
        } else {
          ownersByMissingTimezone.set(tz, [record]);
        }
      }
    }

    const allTimezones = Array.from(wantedTimezones).sort(compareStrings);
    const regionsByKey = new Map<string, TimezoneRegion>();
    const timezoneToRegionKey: Record<string, string> = {};

    for (const timezoneName of allTimezones) {
      if (timezoneName === 'UTC') {
        addUtcRegion(regionsByKey, timezoneToRegionKey);
        continue;
      }

      const owner = resolveOwner(timezoneName, recordByName, ownersByMissingTimezone);

      const fallbackKey = timezoneName.split('/')[0] || timezoneName;
      const regionKey = owner ? toRegionKey(owner, fallbackKey) : fallbackKey;
      const regionLabel = owner ? toRegionLabel(owner, regionKey) : regionKey;
      const existing = regionsByKey.get(regionKey);
      const region: TimezoneRegion = existing || {
        key: regionKey,
        label: regionLabel,
        timezones: [],
      };
      region.timezones.push(timezoneName);
      if (!existing) {
        regionsByKey.set(regionKey, region);
      }
      timezoneToRegionKey[timezoneName] = regionKey;
    }

    const regions = Array.from(regionsByKey.values())
      .map((region) => ({
        ...region,
        timezones: [...region.timezones].sort(compareStrings),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      allTimezones,
      regions,
      timezoneToRegionKey,
    };
  });

  return cachedTimezoneOptionsPromise;
}
