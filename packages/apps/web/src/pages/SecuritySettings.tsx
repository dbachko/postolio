import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SessionList } from '../components/sessions/SessionList';
import { SecurityDashboard } from '../components/security/SecurityDashboard';
import { Shield, Smartphone } from 'lucide-react';

export function SecuritySettings() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Security</h1>
        <p className="mt-2 text-gray-600">Manage your account security and active sessions</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
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
    </div>
  );
}
