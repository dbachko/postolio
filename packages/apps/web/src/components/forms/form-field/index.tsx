import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  error,
  required = false,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
        {!required && <span className="text-muted-foreground ml-1">(optional)</span>}
      </Label>
      {children}
      {error && (
        <p className="text-destructive text-sm" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
