import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { apiClient } from "../lib/api";
import type { Brand } from "../lib/api";

interface InstagramProfile {
  id: string;
  username: string;
  account_type: string;
  name: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
  profile_picture_url?: string;
}

interface InstagramConnectProps {
  brand: Brand;
}

export function InstagramConnect({ brand }: InstagramConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();

  // Check Instagram connection status
  const { data: connectionStatus, isLoading } = useQuery({
    queryKey: ["instagram-status", brand.id],
    queryFn: () => apiClient.getInstagramConnectionStatus(brand.id),
    refetchOnWindowFocus: true,
  });

  // Initialize OAuth flow
  const connectMutation = useMutation({
    mutationFn: () => apiClient.initializeInstagramOAuth(brand.id),
    onSuccess: (data) => {
      // Open OAuth popup
      const popup = window.open(
        data.authUrl,
        "instagram-oauth",
        "width=600,height=700,scrollbars=yes,resizable=yes",
      );

      // Listen for success or error messages from popup
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === "INSTAGRAM_OAUTH_SUCCESS") {
          console.log("Instagram OAuth success:", event.data.data);
          setIsConnecting(false);
          queryClient.invalidateQueries({
            queryKey: ["instagram-status", brand.id],
          });
          window.removeEventListener("message", handleMessage);
        } else if (event.data.type === "INSTAGRAM_OAUTH_ERROR") {
          console.error("Instagram OAuth error:", event.data.data);
          setIsConnecting(false);
          window.removeEventListener("message", handleMessage);
        }
      };
      window.addEventListener("message", handleMessage);

      // Poll for popup closure as fallback
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          // Refresh connection status
          queryClient.invalidateQueries({
            queryKey: ["instagram-status", brand.id],
          });
          window.removeEventListener("message", handleMessage);
        }
      }, 1000);

      setIsConnecting(true);
    },
    onError: (error) => {
      console.error("OAuth initialization failed:", error);
      setIsConnecting(false);
    },
  });

  // Disconnect Instagram
  const disconnectMutation = useMutation({
    mutationFn: () => apiClient.disconnectInstagram(brand.id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["instagram-status", brand.id],
      });
    },
    onError: (error) => {
      console.error("Instagram disconnect failed:", error);
    },
  });

  // Refresh Instagram status with fresh API data
  const refreshStatusMutation = useMutation({
    mutationFn: () => apiClient.getInstagramConnectionStatus(brand.id, true),
    onSuccess: (data) => {
      // Update the query cache with the fresh data instead of just invalidating
      queryClient.setQueryData(["instagram-status", brand.id], data);
    },
    onError: (error) => {
      console.error("Instagram status refresh failed:", error);
      // Don't invalidate the cache on error to prevent undefined state
    },
  });

  const handleConnect = () => {
    connectMutation.mutate();
  };

  const handleDisconnect = () => {
    if (
      window.confirm(
        "Are you sure you want to disconnect your Instagram account? This will stop content publishing.",
      )
    ) {
      disconnectMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Instagram Connection</CardTitle>
          <CardDescription>Checking connection status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-20 bg-gray-100 rounded"></div>
        </CardContent>
      </Card>
    );
  }

  // Handle undefined connectionStatus gracefully
  const isConnected = connectionStatus?.connected ?? false;
  const profile = connectionStatus?.profile as InstagramProfile | null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram Connection</CardTitle>
        <CardDescription>
          Connect your Instagram Business account to enable content publishing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-gray-300"}`}
            />
            <span className="text-sm font-medium">
              {isConnected ? "Connected" : "Not Connected"}
            </span>
          </div>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "Active" : "Inactive"}
          </Badge>
        </div>

        {/* Connected Profile */}
        {isConnected && profile && (
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <img
                  src={
                    profile.profile_picture_url ||
                    "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=150"
                  }
                  alt={`@${profile.username}`}
                  className="w-12 h-12 rounded-full bg-gray-200"
                  onError={(e) => {
                    e.currentTarget.src =
                      "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=150";
                  }}
                />
                <div>
                  <h3 className="font-medium">{profile.name}</h3>
                  <a
                    href={`https://instagram.com/${profile.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    @{profile.username}
                  </a>
                  <div className="flex items-center space-x-4 mt-1">
                    {profile.followers_count !== undefined &&
                      profile.followers_count !== null && (
                        <span className="text-xs text-gray-500">
                          {profile.followers_count.toLocaleString()} followers
                        </span>
                      )}
                    {profile.media_count !== undefined &&
                      profile.media_count !== null && (
                        <span className="text-xs text-gray-500">
                          {profile.media_count === 0
                            ? "No posts yet"
                            : `${profile.media_count} posts`}
                        </span>
                      )}
                  </div>
                </div>
              </div>
              {profile.account_type && (
                <Badge
                  variant={
                    profile.account_type === "BUSINESS"
                      ? "default"
                      : "secondary"
                  }
                  className="ml-2"
                >
                  {profile.account_type === "BUSINESS"
                    ? "Business"
                    : profile.account_type === "CREATOR"
                      ? "Creator"
                      : profile.account_type}
                </Badge>
              )}
            </div>
            {profile.biography && (
              <p className="text-sm text-gray-600 mt-3">{profile.biography}</p>
            )}
          </div>
        )}

        {/* Error Messages */}
        {connectMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {connectMutation.error.message ||
                "Failed to connect Instagram account"}
            </AlertDescription>
          </Alert>
        )}

        {disconnectMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {disconnectMutation.error.message ||
                "Failed to disconnect Instagram account"}
            </AlertDescription>
          </Alert>
        )}

        {refreshStatusMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {refreshStatusMutation.error.message ||
                "Failed to refresh Instagram status"}
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2">
          {isConnected ? (
            <>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending
                  ? "Disconnecting..."
                  : "Disconnect"}
              </Button>
              <Button
                onClick={() => refreshStatusMutation.mutate()}
                variant="secondary"
                disabled={refreshStatusMutation.isPending}
              >
                {refreshStatusMutation.isPending
                  ? "Refreshing..."
                  : "Refresh Status"}
              </Button>
            </>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={connectMutation.isPending || isConnecting}
              className="w-full sm:w-auto"
            >
              {isConnecting ? "Connecting..." : "Connect Instagram Account"}
            </Button>
          )}
        </div>

        {/* Requirements Notice */}
        {!isConnected && (
          <Alert>
            <AlertDescription className="text-sm">
              <strong>Requirements:</strong> You need an Instagram Business or
              Creator account linked to a Facebook Page. Personal accounts
              cannot be used for automated posting.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
