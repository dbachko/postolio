import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo, memo } from 'react'
import { apiClient } from '../lib/api'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { 
  Calendar, 
  Clock, 
  Heart, 
  MessageCircle, 
  Share2, 
  BarChart3, 
  Edit, 
  ArrowLeft,
  Instagram,
  AlertCircle,
  CheckCircle,
  RefreshCw
} from 'lucide-react'
import { format } from 'date-fns'

interface PostDetailData {
  id: string
  caption: string
  hashtags: string[]
  imageUrl?: string
  status: string
  scheduledAt?: string
  postedAt?: string
  instagramPostId?: string
  instagramPermalink?: string
  analytics?: {
    impressions?: number
    reach?: number
    engagement?: number
  }
  generationParams?: {
    theme?: string
    style?: string
  }
  brand: {
    id: string
    name: string
  }
  campaign?: {
    id: string
    name: string
    status: string
  }
  createdAt: string
  updatedAt: string
}

interface PostInsights {
  metrics: {
    impressions: number
    reach: number
    engagement: number
    saves: number
    shares: number
    comments_count: number
    likes_count: number
  }
  lastUpdated: string
}

// Memoized metrics component to prevent unnecessary re-renders
const MetricsGrid = memo(({ insights }: { insights: PostInsights }) => (
  <div className="grid grid-cols-2 gap-3 md:gap-4">
    <div className="p-3 md:p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs md:text-sm text-gray-600">Likes</span>
        <Heart className="h-3 md:h-4 w-3 md:w-4 text-red-500" />
      </div>
      <p className="text-lg md:text-2xl font-bold mt-1">
        {insights.metrics.likes_count.toLocaleString()}
      </p>
    </div>
    
    <div className="p-3 md:p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs md:text-sm text-gray-600">Comments</span>
        <MessageCircle className="h-3 md:h-4 w-3 md:w-4 text-blue-500" />
      </div>
      <p className="text-lg md:text-2xl font-bold mt-1">
        {insights.metrics.comments_count.toLocaleString()}
      </p>
    </div>
    
    <div className="p-3 md:p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs md:text-sm text-gray-600">Reach</span>
        <BarChart3 className="h-3 md:h-4 w-3 md:w-4 text-green-500" />
      </div>
      <p className="text-lg md:text-2xl font-bold mt-1">
        {insights.metrics.reach.toLocaleString()}
      </p>
    </div>
    
    <div className="p-3 md:p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs md:text-sm text-gray-600">Shares</span>
        <Share2 className="h-3 md:h-4 w-3 md:w-4 text-purple-500" />
      </div>
      <p className="text-lg md:text-2xl font-bold mt-1">
        {insights.metrics.shares.toLocaleString()}
      </p>
    </div>
  </div>
))

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [editCaption, setEditCaption] = useState('')
  const [editHashtags, setEditHashtags] = useState<string[]>([])

  // Memoize status color calculation - MUST be before any conditional returns
  const getStatusColor = useMemo(() => {
    return (status: string) => {
      const colors: Record<string, string> = {
        draft: 'bg-gray-100 text-gray-700',
        scheduled: 'bg-blue-100 text-blue-700',
        published: 'bg-green-100 text-green-700',
        failed: 'bg-red-100 text-red-700'
      }
      return colors[status] || 'bg-gray-100 text-gray-700'
    }
  }, [])

  // Fetch post details with auto-refresh
  const { data: post, isLoading: postLoading, isFetching: postFetching } = useQuery<PostDetailData>({
    queryKey: ['post', postId],
    queryFn: async () => {
      const response = await apiClient.getPostDetail(postId!)
      return response.data
    },
    enabled: !!postId,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000 // Consider data stale after 10 seconds
  })


  // Fetch post insights with frequent updates for published posts
  const { data: insights, isFetching: insightsFetching } = useQuery<PostInsights>({
    queryKey: ['post-insights', postId],
    queryFn: async () => {
      const response = await apiClient.getPostInsights(postId!)
      return response.data
    },
    enabled: !!postId && post?.status === 'published',
    refetchInterval: 60000, // Refresh every minute for live metrics
    staleTime: 30000 // Consider insights stale after 30 seconds
  })

  // Fetch comments with pagination
  const { data: commentsData } = useQuery({
    queryKey: ['post-comments', postId],
    queryFn: async () => {
      const response = await apiClient.getPostComments(postId!)
      return response.data
    },
    enabled: !!postId && post?.status === 'published',
    staleTime: 60000 // Keep comments fresh for 1 minute
  })

  // Update post mutation with optimistic updates
  const updatePostMutation = useMutation({
    mutationFn: async (data: { caption: string; hashtags: string[] }) => {
      return apiClient.updatePost(postId!, data)
    },
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['post', postId] })
      
      // Snapshot previous value
      const previousPost = queryClient.getQueryData(['post', postId])
      
      // Optimistically update to the new value
      queryClient.setQueryData(['post', postId], (old: PostDetailData | undefined) => {
        if (!old) return old
        return {
          ...old,
          caption: newData.caption,
          hashtags: newData.hashtags,
          updatedAt: new Date().toISOString()
        }
      })
      
      // Return context with snapshot
      return { previousPost }
    },
    onError: (err, newData, context) => {
      // If mutation fails, use context to roll back
      if (context?.previousPost) {
        queryClient.setQueryData(['post', postId], context.previousPost)
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['post', postId] })
      setIsEditing(false)
    }
  })

  if (postLoading || !post) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const handleEdit = () => {
    setEditCaption(post.caption)
    setEditHashtags(post.hashtags)
    setIsEditing(true)
  }

  const handleSave = () => {
    updatePostMutation.mutate({
      caption: editCaption,
      hashtags: editHashtags
    })
  }

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-4"
          size="sm"
        >
          <ArrowLeft className="mr-1 md:mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold mb-2">Post Details</h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Created {format(new Date(post.createdAt), 'MMM d, yyyy')}
              </span>
              {post.campaign && (
                <span className="flex items-center gap-1">
                  Campaign: {post.campaign.name}
                </span>
              )}
              {(postFetching || insightsFetching) && (
                <span className="flex items-center gap-1 text-blue-600">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Updating...
                </span>
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={getStatusColor(post.status)}>
              {post.status}
            </Badge>
            {post.instagramPermalink && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(post.instagramPermalink, '_blank')}
                className="text-xs sm:text-sm"
              >
                <Instagram className="mr-1 sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">View on</span> Instagram
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6 order-2 lg:order-1">
          {/* Post Content Card */}
          <Card className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg md:text-xl font-semibold">Content</h2>
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>

            {/* Image with lazy loading */}
            {post.imageUrl && (
              <div className="mb-4 rounded-lg overflow-hidden bg-gray-100">
                <img 
                  src={post.imageUrl} 
                  alt="Post content" 
                  className="w-full h-auto object-cover max-h-[400px]"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            )}

            {/* Caption */}
            <div className="space-y-4">
              {isEditing ? (
                <>
                  <textarea
                    value={editCaption}
                    onChange={(e) => setEditCaption(e.target.value)}
                    className="w-full p-3 border rounded-lg min-h-[100px] resize-none"
                    placeholder="Write your caption..."
                  />
                  <input
                    type="text"
                    value={editHashtags.join(' ')}
                    onChange={(e) => setEditHashtags(e.target.value.split(' ').filter(Boolean))}
                    className="w-full p-3 border rounded-lg"
                    placeholder="#hashtag1 #hashtag2"
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleSave} disabled={updatePostMutation.isPending}>
                      Save Changes
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setIsEditing(false)}
                      disabled={updatePostMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-gray-700 whitespace-pre-wrap">{post.caption}</p>
                  <div className="flex flex-wrap gap-2">
                    {post.hashtags.map((tag, index) => (
                      <span key={index} className="text-blue-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Analytics Tab */}
          {post.status === 'published' && (
            <Card className="p-4 md:p-6">
              <Tabs defaultValue="metrics" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="metrics">Metrics</TabsTrigger>
                  <TabsTrigger value="comments">Comments</TabsTrigger>
                </TabsList>

                <TabsContent value="metrics" className="mt-6">
                  {insights ? (
                    <MetricsGrid insights={insights} />
                  ) : (
                    <p className="text-center text-gray-500 py-8">
                      Metrics will be available once the post is published
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="comments" className="mt-6">
                  {commentsData?.comments?.length > 0 ? (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto">
                      {commentsData.comments.map((comment: { username: string; text: string }, index: number) => (
                        <div key={index} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{comment.username}</p>
                            <p className="text-sm text-gray-700 mt-1">{comment.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-gray-500 py-8">
                      No comments yet
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 md:space-y-6 order-1 lg:order-2">
          {/* Post Info */}
          <Card className="p-4 md:p-6">
            <h3 className="font-semibold mb-3 md:mb-4 text-base md:text-lg">Information</h3>
            <div className="space-y-2 md:space-y-3 text-xs md:text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Brand</span>
                <span className="font-medium">{post.brand.name}</span>
              </div>
              
              {post.scheduledAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Scheduled</span>
                  <span className="font-medium">
                    {format(new Date(post.scheduledAt), 'MMM d, h:mm a')}
                  </span>
                </div>
              )}
              
              {post.postedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Published</span>
                  <span className="font-medium">
                    {format(new Date(post.postedAt), 'MMM d, h:mm a')}
                  </span>
                </div>
              )}

              {post.generationParams && (
                <>
                  <hr className="my-3" />
                  <div className="flex justify-between">
                    <span className="text-gray-600">Theme</span>
                    <span className="font-medium">{post.generationParams.theme}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Style</span>
                    <span className="font-medium">{post.generationParams.style}</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Quick Actions */}
          <Card className="p-4 md:p-6">
            <h3 className="font-semibold mb-3 md:mb-4 text-base md:text-lg">Quick Actions</h3>
            <div className="space-y-2">
              {post.status === 'draft' && (
                <Button className="w-full" variant="outline">
                  <Clock className="mr-2 h-4 w-4" />
                  Schedule Post
                </Button>
              )}
              
              {post.status === 'scheduled' && (
                <Button className="w-full" variant="outline">
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Publish Now
                </Button>
              )}
              
              <Button className="w-full" variant="destructive">
                <AlertCircle className="mr-2 h-4 w-4" />
                Delete Post
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}