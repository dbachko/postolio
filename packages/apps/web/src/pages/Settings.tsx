import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimezoneSettingsTab from './settings/TimezoneSettingsTab';
import AccountSettingsTab from './settings/AccountSettingsTab';
import NotificationsSettingsTab from './settings/NotificationsSettingsTab';
import AppearanceSettingsTab from './settings/AppearanceSettingsTab';

type SettingsTab = 'timezone' | 'account' | 'notifications' | 'appearance';

export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive active tab from query params (tab=...) with a safe fallback
  const activeTab: SettingsTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') as SettingsTab | null;
    if (tab === 'account' || tab === 'notifications' || tab === 'appearance' || tab === 'timezone')
      return tab;
    return 'timezone';
  }, [location.search]);

  // When navigating to #delete-account, ensure account tab is selected
  useEffect(() => {
    if (location.hash === '#delete-account' && activeTab !== 'account') {
      const params = new URLSearchParams(location.search);
      params.set('tab', 'account');
      navigate(
        { pathname: location.pathname, search: params.toString(), hash: location.hash },
        { replace: true }
      );
    }
  }, [location.hash, activeTab, location.pathname, location.search, navigate]);

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(location.search);
    params.set('tab', value);
    navigate(
      { pathname: location.pathname, search: params.toString(), hash: location.hash },
      { replace: true }
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account and application preferences
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="timezone">Timezone</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="timezone">
          <TimezoneSettingsTab />
        </TabsContent>

        <TabsContent value="account">
          <AccountSettingsTab />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsSettingsTab />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Settings;
