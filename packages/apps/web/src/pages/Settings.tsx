import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import TimezoneSettingsTab from './settings/TimezoneSettingsTab';
import AccountSettingsTab from './settings/AccountSettingsTab';
import NotificationsSettingsTab from './settings/NotificationsSettingsTab';
import AppearanceSettingsTab from './settings/AppearanceSettingsTab';

export function Settings() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account and application preferences
        </p>
      </div>

      <Tabs defaultValue="timezone" className="space-y-6">
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
