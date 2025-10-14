interface Props {
  currentStep: number;
}

const steps = [
  { id: 1, label: 'Type' },
  { id: 2, label: 'Brief' },
  { id: 3, label: 'Strategy' },
  { id: 4, label: 'Timeline' },
  { id: 5, label: 'Review' },
];

export function WizardProgress({ currentStep }: Props) {
  return (
    <div className="mb-6 flex items-center gap-3 overflow-x-auto">
      {steps.map((s, idx) => (
        <div key={s.id} className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              currentStep >= s.id ? 'bg-primary text-white' : 'bg-gray-200 text-gray-600'
            }`}
          >
            {s.id}
          </div>
          <span className="text-sm">{s.label}</span>
          {idx < steps.length - 1 && <div className="h-px w-8 bg-gray-300" />}
        </div>
      ))}
    </div>
  );
}
