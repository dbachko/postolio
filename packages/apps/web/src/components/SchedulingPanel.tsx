import { useState } from 'react';

interface ScheduledPost {
  id: string;
  caption: string;
  imageUrl: string;
  hashtags: string[];
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
    <div className="rounded-lg bg-white p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">Scheduled Posts</h3>

      {scheduledPosts.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No posts scheduled</p>
      ) : (
        <div className="space-y-4">
          {scheduledPosts.map((post) => (
            <div key={post.id} className="rounded-lg border p-4">
              <div className="flex items-start space-x-4">
                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt="Post preview"
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                )}

                <div className="flex-1">
                  <p className="mb-2 line-clamp-2 text-sm text-gray-800">{post.caption}</p>

                  <div className="mb-2 flex flex-wrap gap-1">
                    {post.hashtags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700"
                      >
                        #{tag}
                      </span>
                    ))}
                    {post.hashtags.length > 3 && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        +{post.hashtags.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="text-sm text-gray-600">
                    <div>Scheduled: {formatScheduledTime(post.scheduledTime)}</div>
                    <div className="font-medium text-blue-600">
                      In {getTimeUntilPost(post.scheduledTime)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-2">
                  <button
                    onClick={() => setRescheduleId(post.id)}
                    className="rounded bg-blue-100 px-3 py-1 text-xs text-blue-700 hover:bg-blue-200"
                  >
                    Reschedule
                  </button>
                  <button
                    onClick={() => onCancelPost(post.id)}
                    className="rounded bg-red-100 px-3 py-1 text-xs text-red-700 hover:bg-red-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {rescheduleId === post.id && (
                <div className="mt-4 rounded-lg bg-gray-50 p-3">
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    New Schedule Time
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="datetime-local"
                      value={newDateTime}
                      onChange={(e) => setNewDateTime(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleReschedule}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => {
                        setRescheduleId(null);
                        setNewDateTime('');
                      }}
                      className="rounded-lg bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-400"
                    >
                      Cancel
                    </button>
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
