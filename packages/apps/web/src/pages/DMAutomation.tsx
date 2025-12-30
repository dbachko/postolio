import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useBrandStore } from '@/stores/brandStore';
import { RulesList } from '@/components/dm-automation/rules-list';
import { AnalyticsDashboard } from '@/components/dm-automation/analytics-dashboard';

export function DMAutomation() {
  const { selectedBrand } = useBrandStore();
  const [activeTab, setActiveTab] = useState('rules');

  if (!selectedBrand) {
    return (
      <div className="w-full py-8">
        <Card>
          <CardHeader>
            <CardTitle>No Brand Selected</CardTitle>
            <CardDescription>Please select a brand to manage DM automation rules.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full py-8">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="rules">Automation Rules</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-6">
          <RulesList brandId={selectedBrand.id} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <AnalyticsDashboard brandId={selectedBrand.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
