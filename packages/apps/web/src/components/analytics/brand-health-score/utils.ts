export function getFactorColorClass(value: number) {
  if (value >= 80) return 'bg-emerald-500 dark:bg-emerald-600';
  if (value >= 60) return 'bg-blue-500 dark:bg-blue-600';
  if (value >= 40) return 'bg-amber-500 dark:bg-amber-600';
  return 'bg-red-500 dark:bg-red-600';
}

export function getCircleProgress(params: { score: number; radius: number }) {
  const { score, radius } = params;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;
  return { circumference, progress };
}
