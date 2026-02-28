import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CountrySelect } from './country-select';

type CreateFormData = { name: string; description: string; countryCode: string };

type CreateBrandPanelProps = {
  formData: CreateFormData;
  isPending: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onChange: (next: CreateFormData) => void;
};

export function CreateBrandPanel({
  formData,
  isPending,
  errorMessage,
  onCancel,
  onSubmit,
  onChange,
}: CreateBrandPanelProps) {
  return (
    <div className="bg-card rounded-lg p-6 shadow">
      <h2 className="mb-4 text-lg font-medium">Create New Brand</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        {errorMessage ? (
          <div className="rounded-md border p-3">
            <p className="text-destructive text-sm">{errorMessage}</p>
          </div>
        ) : null}

        <div>
          <Label htmlFor="create-name">Brand Name</Label>
          <Input
            id="create-name"
            type="text"
            required
            value={formData.name}
            onChange={(event) => onChange({ ...formData, name: event.target.value })}
            placeholder="Enter brand name..."
          />
        </div>

        <div>
          <Label htmlFor="create-description">Description</Label>
          <Textarea
            id="create-description"
            rows={3}
            value={formData.description}
            onChange={(event) => onChange({ ...formData, description: event.target.value })}
            placeholder="Brief description of your brand..."
          />
        </div>

        <div>
          <Label>Country</Label>
          <CountrySelect
            value={formData.countryCode}
            onChange={(countryCode) => onChange({ ...formData, countryCode })}
          />
        </div>

        <div className="flex justify-end space-x-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} variant="neutral">
            {isPending ? 'Creating...' : 'Create Brand'}
          </Button>
        </div>
      </form>
    </div>
  );
}
