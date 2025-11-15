import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import NotificationPreferencesPanel from './NotificationPreferencesPanel';

export default function NotificationsSettingsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>
          Configure channels for each notification type. Critical events default to email if not
          configured.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <NotificationPreferencesPanel />
      </CardContent>
    </Card>
  );
}
