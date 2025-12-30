import { SCORE_GAUGE_RADIUS } from '../constants';
import { getCircleProgress } from '../utils';

interface ScoreGaugeProps {
  score: number;
  ringGradient: string;
  textColor: string;
  gradientStartColor: string;
  gradientEndColor: string;
}

export function ScoreGauge({
  score,
  ringGradient,
  textColor,
  gradientStartColor,
  gradientEndColor,
}: ScoreGaugeProps) {
  const { circumference, progress } = getCircleProgress({ score, radius: SCORE_GAUGE_RADIUS });

  return (
    <div className="flex justify-center lg:justify-start">
      <div className="relative h-48 w-48">
        <div
          className={`absolute inset-0 rounded-full bg-gradient-to-br ${ringGradient} opacity-20 blur-2xl`}
        />

        <svg className="h-full w-full -rotate-90 transform drop-shadow-lg" viewBox="0 0 160 160">
          <circle
            cx="80"
            cy="80"
            r="75"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            className="text-muted-foreground/20"
            strokeDasharray="2 4"
          />

          <circle
            cx="80"
            cy="80"
            r={SCORE_GAUGE_RADIUS}
            stroke="currentColor"
            strokeWidth="14"
            fill="none"
            className="text-muted-foreground/10"
          />

          <circle
            cx="80"
            cy="80"
            r={SCORE_GAUGE_RADIUS}
            stroke="url(#scoreGradient)"
            strokeWidth="14"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
            style={{ filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.1))' }}
          />

          <defs>
            <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradientStartColor} />
              <stop offset="100%" stopColor={gradientEndColor} />
            </linearGradient>
          </defs>
        </svg>

        <div className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          <div className={`text-5xl font-bold ${textColor} drop-shadow-sm`}>{score}</div>
        </div>
      </div>
    </div>
  );
}
