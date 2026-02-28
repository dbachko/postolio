import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  humanizeKey,
  isNonEmptyString,
  type ObjectSchema,
  type SchemaProperty,
  toStringValue,
} from './skills-schema';

type SchemaFieldsProps = {
  schema: ObjectSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  forceSecret?: boolean;
};

type SchemaFieldProps = {
  fieldKey: string;
  property: SchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  forceSecret: boolean;
};

function RequiredMark({ required }: { required: boolean }) {
  return required ? <span className="text-destructive"> *</span> : null;
}

function FieldLabel({ label, required }: { label: string; required: boolean }) {
  return (
    <Label>
      {label}
      <RequiredMark required={required} />
    </Label>
  );
}

function FieldDescription({ description }: { description?: string }) {
  if (!description) {
    return null;
  }
  return <p className="text-muted-foreground text-xs">{description}</p>;
}

function EnumField({
  fieldKey,
  label,
  property,
  required,
  value,
  onChange,
}: {
  fieldKey: string;
  label: string;
  property: SchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const enumValues = Array.isArray(property.enum)
    ? property.enum.filter((item): item is string => typeof item === 'string')
    : [];
  const current = isNonEmptyString(value) ? value : toStringValue(property.default) || undefined;

  return (
    <div className="space-y-1">
      <FieldLabel label={label} required={required} />
      <Select value={current} onValueChange={(next) => onChange(fieldKey, next)}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {enumValues.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription description={property.description} />
    </div>
  );
}

function BooleanField({
  fieldKey,
  label,
  property,
  required,
  value,
  onChange,
}: {
  fieldKey: string;
  label: string;
  property: SchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  let checked = false;
  if (typeof value === 'boolean') {
    checked = value;
  } else if (typeof property.default === 'boolean') {
    checked = property.default;
  }

  return (
    <div className="border-border flex items-center justify-between rounded-md border p-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">
          {label}
          <RequiredMark required={required} />
        </Label>
        <FieldDescription description={property.description} />
      </div>
      <Switch checked={checked} onCheckedChange={(next) => onChange(fieldKey, next)} />
    </div>
  );
}

function TextField({
  fieldKey,
  label,
  property,
  required,
  value,
  onChange,
  forceSecret,
}: {
  fieldKey: string;
  label: string;
  property: SchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  forceSecret: boolean;
}) {
  const isSecret = forceSecret || property.secret === true;
  let inputType: 'password' | 'number' | 'text' = 'text';
  if (isSecret) {
    inputType = 'password';
  } else if (property.type === 'number') {
    inputType = 'number';
  }

  return (
    <div className="space-y-1">
      <FieldLabel label={label} required={required} />
      <Input
        type={inputType}
        value={toStringValue(value)}
        onChange={(event) => onChange(fieldKey, event.target.value)}
        placeholder={property.placeholder}
        autoComplete={isSecret ? 'off' : undefined}
      />
      <FieldDescription description={property.description} />
    </div>
  );
}

function SchemaFieldRow({
  fieldKey,
  property,
  required,
  value,
  onChange,
  forceSecret,
}: SchemaFieldProps) {
  const label = property.title || humanizeKey(fieldKey) || fieldKey;
  const enumValues = Array.isArray(property.enum)
    ? property.enum.filter((item): item is string => typeof item === 'string')
    : [];

  if (enumValues.length > 0) {
    return (
      <EnumField
        fieldKey={fieldKey}
        label={label}
        property={property}
        required={required}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (property.type === 'boolean') {
    return (
      <BooleanField
        fieldKey={fieldKey}
        label={label}
        property={property}
        required={required}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <TextField
      fieldKey={fieldKey}
      label={label}
      property={property}
      required={required}
      value={value}
      onChange={onChange}
      forceSecret={forceSecret}
    />
  );
}

export function SchemaFields({ schema, values, onChange, forceSecret = false }: SchemaFieldsProps) {
  const entries = Object.entries(schema.properties);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {entries.map(([fieldKey, property]) => (
        <SchemaFieldRow
          key={fieldKey}
          fieldKey={fieldKey}
          property={property}
          required={schema.required.has(fieldKey)}
          value={values[fieldKey]}
          onChange={onChange}
          forceSecret={forceSecret}
        />
      ))}
    </div>
  );
}
