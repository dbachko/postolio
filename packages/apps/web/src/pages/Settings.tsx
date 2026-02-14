import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimezoneSettingsTab from './settings/TimezoneSettingsTab';
import AccountSettingsTab from './settings/AccountSettingsTab';
import NotificationsSettingsTab from './settings/NotificationsSettingsTab';
import AppearanceSettingsTab from './settings/AppearanceSettingsTab';
import ImageAnalytics from './settings/ImageAnalytics';

type SettingsTab = 'timezone' | 'account' | 'notifications' | 'appearance' | 'analytics';

export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();

  // Derive active tab from query params (tab=...) with a safe fallback
  const activeTab: SettingsTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab') as SettingsTab | null;
    if (
      tab === 'account' ||
      tab === 'notifications' ||
      tab === 'appearance' ||
      tab === 'timezone' ||
      tab === 'analytics'
    )
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
    if (value === 'billing') {
      navigate('/settings/billing');
      return;
    }

    const params = new URLSearchParams(location.search);
    params.set('tab', value);
    navigate(
      { pathname: location.pathname, search: params.toString(), hash: location.hash },
      { replace: true }
    );
  };

  return (
    <div className="w-full">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="timezone">Timezone</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
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

        <TabsContent value="analytics">
          <ImageAnalytics />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Settings;
