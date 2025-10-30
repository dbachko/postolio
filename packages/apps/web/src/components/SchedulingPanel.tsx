import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPostImageOrPlaceholder } from '@/lib/placeholders';

interface ScheduledPost {
  id: string;
  caption: string;
  imageUrl: string;
  // Some scheduled posts may not include hashtags; handle as optional
  hashtags?: string[];
  scheduledTime: string;
  status: string;
}

interface SchedulingPanelProps {
  scheduledPosts: ScheduledPost[];
  onCancelPost: (contentId: string) => void;
  onReschedulePost: (contentId: string, newTime: string) => void;
}

export default function SchedulingPanel({
  scheduledPosts,
  onCancelPost,
  onReschedulePost,
}: SchedulingPanelProps) {
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newDateTime, setNewDateTime] = useState('');

  const handleReschedule = () => {
    if (rescheduleId && newDateTime) {
      onReschedulePost(rescheduleId, newDateTime);
      setRescheduleId(null);
      setNewDateTime('');
    }
  };

  const formatScheduledTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getTimeUntilPost = (dateString: string) => {
    const now = new Date();
    const scheduledTime = new Date(dateString);
    const diffMs = scheduledTime.getTime() - now.getTime();

    if (diffMs < 0) return 'Overdue';

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 24) {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ${diffHours % 24}h`;
    }

    return `${diffHours}h ${diffMinutes}m`;
  };

  return (
    <div className="bg-card rounded-lg p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">Scheduled Posts</h3>

      {scheduledPosts.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">No posts scheduled</p>
      ) : (
        <div className="space-y-4">
          {scheduledPosts.map((post) => (
            <div key={post.id} className="rounded-lg border p-4">
              <div className="flex items-start space-x-4">
                <img
                  src={getPostImageOrPlaceholder(post.imageUrl)}
                  alt="Post preview"
                  className="h-16 w-16 rounded-lg object-cover"
                  loading="lazy"
                  decoding="async"
                />

                <div className="flex-1">
                  <p className="text-foreground mb-2 line-clamp-2 text-sm">{post.caption}</p>

                  <div className="mb-2 flex flex-wrap gap-1">
                    {(Array.isArray(post.hashtags) ? post.hashtags : [])
                      .slice(0, 3)
                      .map((tag, index) => {
                        const t =
                          typeof tag === 'string' && tag.startsWith('#') ? tag.slice(1) : tag;
                        return (
                          <span key={index} className="bg-muted rounded-full px-2 py-1 text-xs">
                            #{t}
                          </span>
                        );
                      })}
                    {Array.isArray(post.hashtags) && post.hashtags.length > 3 && (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-1 text-xs">
                        +{post.hashtags.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="text-muted-foreground text-sm">
                    <div>Scheduled: {formatScheduledTime(post.scheduledTime)}</div>
                    <div className="text-foreground font-medium">
                      In {getTimeUntilPost(post.scheduledTime)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-2">
                  <Button size="sm" variant="outline" onClick={() => setRescheduleId(post.id)}>
                    Reschedule
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onCancelPost(post.id)}>
                    Cancel
                  </Button>
                </div>
              </div>

              {rescheduleId === post.id && (
                <div className="bg-muted mt-4 rounded-lg p-3">
                  <Label className="mb-2">New Schedule Time</Label>
                  <div className="flex space-x-2">
                    <Input
                      type="datetime-local"
                      value={newDateTime}
                      onChange={(e) => setNewDateTime(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={handleReschedule}>Update</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRescheduleId(null);
                        setNewDateTime('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
