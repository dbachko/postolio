import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type CountrySelectProps = {
  value: string;
  onChange: (code: string) => void;
};

const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'BE', name: 'Belgium' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'MX', name: 'Mexico' },
];

function codeToFlag(code: string) {
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function CountrySelect({ value, onChange }: CountrySelectProps) {
  const selected = COUNTRIES.find((c) => c.code === (value || '').toUpperCase());

  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className="w-60">
        <SelectValue
          placeholder="Select country"
          aria-label={selected ? selected.name : 'Select country'}
        >
          {selected ? (
            <span className="flex items-center gap-2">
              <span>{codeToFlag(selected.code)}</span>
              <span>
                {selected.name} ({selected.code})
              </span>
            </span>
          ) : (
            'Select country'
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {COUNTRIES.map((c) => (
          <SelectItem key={c.code} value={c.code} aria-label={`${c.name} ${c.code}`}>
            <span className="flex items-center gap-2">
              <span>{codeToFlag(c.code)}</span>
              <span>
                {c.name} ({c.code})
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
