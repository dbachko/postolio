import { useState } from "react";

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
  const [newDateTime, setNewDateTime] = useState("");

  const handleReschedule = () => {
    if (rescheduleId && newDateTime) {
      onReschedulePost(rescheduleId, newDateTime);
      setRescheduleId(null);
      setNewDateTime("");
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

    if (diffMs < 0) return "Overdue";

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 24) {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ${diffHours % 24}h`;
    }

    return `${diffHours}h ${diffMinutes}m`;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-4">Scheduled Posts</h3>

      {scheduledPosts.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No posts scheduled</p>
      ) : (
        <div className="space-y-4">
          {scheduledPosts.map((post) => (
            <div key={post.id} className="border rounded-lg p-4">
              <div className="flex items-start space-x-4">
                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt="Post preview"
                    className="w-16 h-16 object-cover rounded-lg"
                  />
                )}

                <div className="flex-1">
                  <p className="text-sm text-gray-800 mb-2 line-clamp-2">
                    {post.caption}
                  </p>

                  <div className="flex flex-wrap gap-1 mb-2">
                    {post.hashtags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                      >
                        #{tag}
                      </span>
                    ))}
                    {post.hashtags.length > 3 && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                        +{post.hashtags.length - 3} more
                      </span>
                    )}
                  </div>

                  <div className="text-sm text-gray-600">
                    <div>
                      Scheduled: {formatScheduledTime(post.scheduledTime)}
                    </div>
                    <div className="font-medium text-blue-600">
                      In {getTimeUntilPost(post.scheduledTime)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-2">
                  <button
                    onClick={() => setRescheduleId(post.id)}
                    className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    Reschedule
                  </button>
                  <button
                    onClick={() => onCancelPost(post.id)}
                    className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {rescheduleId === post.id && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    New Schedule Time
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="datetime-local"
                      value={newDateTime}
                      onChange={(e) => setNewDateTime(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleReschedule}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => {
                        setRescheduleId(null);
                        setNewDateTime("");
                      }}
                      className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
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
