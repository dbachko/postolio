interface Props {
  currentStep: number;
}

const steps = [
  { id: 1, label: 'Type' },
  { id: 2, label: 'Goals & Timeline' },
  { id: 3, label: 'Themes' },
  { id: 4, label: 'Images' },
  { id: 5, label: 'Strategy' },
  { id: 6, label: 'Timeline' },
  { id: 7, label: 'Review' },
];

export function WizardProgress({ currentStep }: Props) {
  return (
    <div className="mb-6 flex items-center gap-3 overflow-x-auto">
      {steps.map((s, idx) => (
        <div key={s.id} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              currentStep >= s.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {s.id}
          </div>
          <span className="text-sm">{s.label}</span>
          {idx < steps.length - 1 && <div className="bg-muted h-px w-8" />}
        </div>
      ))}
    </div>
  );
}
