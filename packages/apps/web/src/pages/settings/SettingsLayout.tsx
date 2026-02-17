import type { ReactNode } from 'react';

type SettingsLayoutProps = {
  children: ReactNode;
};

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="w-full">
      <section className="min-w-0 space-y-6">{children}</section>
    </div>
  );
}
