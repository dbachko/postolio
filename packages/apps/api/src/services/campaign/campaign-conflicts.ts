import type { SchedulingConflict } from '../campaign-coordination.js';

export function buildConflictSummary(conflicts: SchedulingConflict[]): {
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: { type: string; severity: SchedulingConflict['severity']; details: string }[];
} {
  if (!conflicts.length) {
    return { hasConflicts: false, conflictCount: 0, conflicts: [] };
  }

  return {
    hasConflicts: true,
    conflictCount: conflicts.length,
    conflicts: conflicts.map((c) => ({
      type: c.conflictType,
      severity: c.severity,
      details: c.details,
    })),
  };
}
