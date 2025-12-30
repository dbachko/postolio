import { Badge } from '@/components/ui/badge';

interface ConnectionStatusRowProps {
  isConnected: boolean;
}

export function ConnectionStatusRow({ isConnected }: ConnectionStatusRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <div
          className={`h-2 w-2 rounded-full ${isConnected ? 'bg-foreground' : 'bg-muted-foreground'}`}
        />
        <span className="text-sm font-medium">{isConnected ? 'Connected' : 'Not Connected'}</span>
      </div>
      <Badge variant={isConnected ? 'default' : 'secondary'}>
        {isConnected ? 'Active' : 'Inactive'}
      </Badge>
    </div>
  );
}
