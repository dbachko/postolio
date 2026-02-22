import { PassphraseSuggestion } from '@/components/passphrase-suggestion';
import { getPasswordStrength, getStrengthColor } from '@/utils/validation';

interface PasswordStrengthMeterProps {
  password: string;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) {
    return null;
  }

  const strength = getPasswordStrength(password);
  const color = getStrengthColor(strength.level);

  return (
    <div className="mt-2 space-y-2" role="status" aria-live="polite" aria-atomic="true">
      {/* Progress Bar */}
      <div className="bg-muted relative h-2 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${strength.progress}%`,
            backgroundColor: color,
          }}
          role="progressbar"
          aria-valuenow={strength.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Password strength: ${strength.level}`}
        />
        {/* Milestone markers */}
        <div
          className="absolute top-0 left-[40%] h-full w-px"
          style={{ backgroundColor: 'var(--border)' }}
          aria-hidden="true"
        />
        <div
          className="absolute top-0 left-[60%] h-full w-px"
          style={{ backgroundColor: 'var(--border)' }}
          aria-hidden="true"
        />
        <div
          className="absolute top-0 left-[75%] h-full w-px"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      </div>

      {/* Strength Label and Message */}
      <div className="flex items-center justify-between text-sm">
        <span
          className="font-medium"
          style={{ color }}
          aria-label={`Strength level: ${strength.level}`}
        >
          {strength.level.charAt(0).toUpperCase() + strength.level.slice(1)}
        </span>
        <span className="text-muted-foreground" aria-label="Password requirement message">
          {strength.message}
        </span>
      </div>

      {/* Complexity Rules (shown only when needed) */}
      {strength.showComplexityRules && password.length < 15 && (
        <div className="text-muted-foreground space-y-1 text-xs">
          {password.length < 8 && <div>• At least 8 characters required</div>}
          {password.length >= 8 && password.length < 15 && (
            <>
              <div>• Add uppercase, numbers, or symbols</div>
              <div>• Or use {15 - password.length} more characters</div>
            </>
          )}
        </div>
      )}

      {/* Passphrase Suggestion */}
      {password.length > 0 && password.length < 15 && <PassphraseSuggestion />}
    </div>
  );
}
