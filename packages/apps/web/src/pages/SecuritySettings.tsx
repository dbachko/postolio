import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SessionList } from '@/components/sessions/session-list';
import { SecurityDashboard } from '@/components/security/security-dashboard';
import { Shield, Smartphone } from 'lucide-react';
import SettingsLayout from './settings/SettingsLayout';

export function SecuritySettings() {
  return (
    <SettingsLayout>
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:w-[420px]">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="devices" className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Devices
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <SecurityDashboard />
        </TabsContent>

        <TabsContent value="devices" className="space-y-6">
          <SessionList />
        </TabsContent>
      </Tabs>
    </SettingsLayout>
  );
}
