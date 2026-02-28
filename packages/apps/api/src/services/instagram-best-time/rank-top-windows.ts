import { TimezoneService } from '../timezone.js';
import {
  DEFAULT_MIN_GAP_HOURS,
  DEFAULT_SLOTS_PER_DAY,
  DEFAULT_WINDOW_MINUTES,
  type Heatmap,
} from './types.js';

type Candidate = {
  day: number;
  hour: number;
  minute: number;
  minuteOfDay: number;
  score: number;
};

function sortCandidates(left: Candidate, right: Candidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (left.minute !== right.minute) {
    return right.minute - left.minute;
  }
  return left.hour - right.hour;
}

function isTooClose(minuteA: number, minuteB: number, minGapMinutes: number): boolean {
  const diff = Math.abs(minuteA - minuteB);
  return Math.min(diff, 24 * 60 - diff) < minGapMinutes;
}

function buildDayRankings(heatmap: Heatmap): Candidate[][] {
  const dayHourRanks: Candidate[][] = [];
  for (let day = 0; day < 7; day++) {
    const hours: Candidate[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const scoreOnHour = heatmap[day][hour];
      const nextHour = heatmap[day][(hour + 1) % 24];
      const scoreHalfHour = (scoreOnHour + nextHour) / 2;

      hours.push({ day, hour, minute: 0, minuteOfDay: hour * 60, score: scoreOnHour });
      hours.push({
        day,
        hour,
        minute: 30,
        minuteOfDay: hour * 60 + 30,
        score: +scoreHalfHour.toFixed(4),
      });
    }
    hours.sort(sortCandidates);
    dayHourRanks[day] = hours;
  }

  return dayHourRanks;
}

function pickForDay(params: {
  day: number;
  dayHourRanks: Candidate[][];
  pickedByDay: Map<number, Candidate[]>;
  usedHoursGlobal: Set<number>;
  minGapMinutes: number;
  preferUnusedGlobalHour: boolean;
}): Candidate | null {
  const already = params.pickedByDay.get(params.day) || [];
  const ranks = params.dayHourRanks[params.day] || [];

  for (const candidate of ranks) {
    if (params.preferUnusedGlobalHour && params.usedHoursGlobal.has(candidate.hour)) {
      continue;
    }
    if (
      already.some((picked) =>
        isTooClose(picked.minuteOfDay, candidate.minuteOfDay, params.minGapMinutes)
      )
    ) {
      continue;
    }
    return candidate;
  }

  if (!params.preferUnusedGlobalHour) {
    return null;
  }

  for (const candidate of ranks) {
    if (
      already.some((picked) =>
        isTooClose(picked.minuteOfDay, candidate.minuteOfDay, params.minGapMinutes)
      )
    ) {
      continue;
    }
    return candidate;
  }

  return null;
}

function formatCandidateOutput(params: {
  picked: Candidate[];
  timezone: string;
  windowMinutes: number;
}) {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);

  return params.picked.map((candidate) => {
    const localStart = new Date(sunday);
    localStart.setDate(sunday.getDate() + candidate.day);
    localStart.setHours(candidate.hour, candidate.minute, 0, 0);

    const utc = TimezoneService.toUTC(localStart, params.timezone);
    const startUTC = utc.toISOString();
    const startLocal = TimezoneService.formatWithTimezone(
      utc,
      params.timezone,
      "yyyy-MM-dd'T'HH:mmXXX"
    );

    return {
      startLocal,
      startUTC,
      durationMinutes: params.windowMinutes,
      score: +candidate.score.toFixed(4),
      explanation: undefined,
    };
  });
}

export function rankTopWindows(
  heatmap: Heatmap,
  timezone: string,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
  topN = DEFAULT_SLOTS_PER_DAY * 7
) {
  const slotsPerDay = Math.max(1, DEFAULT_SLOTS_PER_DAY);
  const minGapMinutes = Math.max(1, DEFAULT_MIN_GAP_HOURS) * 60;
  const targetCount = Math.max(1, topN);

  const dayHourRanks = buildDayRankings(heatmap);
  const pickedByDay = new Map<number, Candidate[]>();
  const usedHoursGlobal = new Set<number>();

  const dayBest = Array.from({ length: 7 }, (_, day) => ({ day, best: dayHourRanks[day]?.[0] }))
    .filter((entry) => entry.best)
    .sort((left, right) => (right.best?.score ?? 0) - (left.best?.score ?? 0));

  for (const { day } of dayBest) {
    const chosen = pickForDay({
      day,
      dayHourRanks,
      pickedByDay,
      usedHoursGlobal,
      minGapMinutes,
      preferUnusedGlobalHour: true,
    });
    if (!chosen) {
      continue;
    }
    pickedByDay.set(day, [chosen]);
    usedHoursGlobal.add(chosen.hour);
  }

  for (let slot = 2; slot <= slotsPerDay; slot++) {
    for (let day = 0; day < 7; day++) {
      const chosen = pickForDay({
        day,
        dayHourRanks,
        pickedByDay,
        usedHoursGlobal,
        minGapMinutes,
        preferUnusedGlobalHour: false,
      });
      if (!chosen) {
        continue;
      }
      const list = pickedByDay.get(day) || [];
      list.push(chosen);
      pickedByDay.set(day, list);
    }
  }

  const picked = Array.from(pickedByDay.values())
    .flat()
    .sort((left, right) => right.score - left.score)
    .slice(0, targetCount);

  return formatCandidateOutput({ picked, timezone, windowMinutes });
}
