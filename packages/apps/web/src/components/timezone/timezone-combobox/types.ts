import type { ReactNode } from 'react';

type BaseProps = {
  buttonClassName?: string;
  disabled?: boolean;
  id?: string;
  leadingIcon?: ReactNode;
  openOnMount?: boolean;
  placeholder?: string;
};

type RequiredProps = BaseProps & {
  value: string;
  onValueChange: (value: string) => void;
  allowClear?: false;
};

type OptionalProps = BaseProps & {
  value: string | null;
  onValueChange: (value: string | null) => void;
  allowClear: true;
  clearLabel: string;
};

export type TimezoneComboboxProps = RequiredProps | OptionalProps;

export type ViewMode = 'regions' | 'timezones';
