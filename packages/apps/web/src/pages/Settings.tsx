import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import TimezoneSettingsTab from './settings/TimezoneSettingsTab';
import AccountSettingsTab from './settings/AccountSettingsTab';
import NotificationsSettingsTab from './settings/NotificationsSettingsTab';
import AppearanceSettingsTab from './settings/AppearanceSettingsTab';
import ImageAnalytics from './settings/ImageAnalytics';
import SettingsLayout from './settings/SettingsLayout';

type SettingsSectionConfig = {
  content: ReactNode;
};

const SETTINGS_SECTION_CONFIG: Record<string, SettingsSectionConfig> = {
  '/settings': {
    content: <TimezoneSettingsTab />,
  },
  '/settings/notifications': {
    content: <NotificationsSettingsTab />,
  },
  '/settings/appearance': {
    content: <AppearanceSettingsTab />,
  },
  '/settings/account': {
    content: <AccountSettingsTab />,
  },
  '/settings/analytics': {
    content: <ImageAnalytics />,
  },
};

export function Settings() {
  const location = useLocation();

  const section =
    SETTINGS_SECTION_CONFIG[location.pathname] ?? SETTINGS_SECTION_CONFIG['/settings'];

  return <SettingsLayout>{section.content}</SettingsLayout>;
}

export default Settings;
