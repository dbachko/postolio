import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
import { useNavigate } from "react-router-dom";
import { CheckCircle, AlertCircle } from "lucide-react";
import { TIMEOUTS } from "@/constants/timeouts";
import type { GoogleCredentialResponse } from "@/types/oauth";

interface GoogleSignInIsolatedProps {
  mode: "signin" | "signup" | "link";
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function GoogleSignInIsolated({
  mode,
  onSuccess,
  onError,
}: GoogleSignInIsolatedProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const { setUser, setToken } = useAuthStore();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);

  // Check if Google OAuth is configured
  const isConfigured =
    import.meta.env.VITE_GOOGLE_CLIENT_ID &&
    import.meta.env.VITE_GOOGLE_CLIENT_ID !== "";

  const handleGoogleResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (!response.credential) {
        const errorMsg = "No credential received from Google";
        onError?.(errorMsg);
        toast.error("Google sign-in failed", {
          description: errorMsg,
          icon: <AlertCircle className="text-red-500" />,
        });
        return;
      }

      setIsLoading(true);

      try {
        const endpoint =
          mode === "link" ? "/api/auth/google/link" : "/api/auth/google/verify";

        const apiResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(mode === "link" && localStorage.getItem("token")
              ? { Authorization: `Bearer ${localStorage.getItem("token")}` }
              : {}),
          },
          credentials: "include",
          body: JSON.stringify({
            credential: response.credential,
          }),
        });

        const data = await apiResponse.json();

        if (!apiResponse.ok) {
          throw new Error(data.error || "Google authentication failed");
        }

        if (mode !== "link") {
          setToken(data.token);
          setUser(data.user);
          localStorage.setItem("token", data.token);

          const actionText = data.isNewUser ? "Account created" : "Signed in";
          toast.success(`${actionText} successfully!`, {
            description: "Welcome to Postolio! Redirecting...",
            icon: <CheckCircle className="text-green-500" />,
            duration: TIMEOUTS.TOAST_DURATION,
          });

          setTimeout(() => {
            navigate("/dashboard");
          }, TIMEOUTS.SUCCESS_REDIRECT);
        } else {
          toast.success("Google account linked!", {
            description: "You can now sign in with Google",
            icon: <CheckCircle className="text-green-500" />,
          });
        }

        onSuccess?.();
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : "Google authentication failed";
        onError?.(errorMsg);
        toast.error("Authentication failed", {
          description: errorMsg,
          icon: <AlertCircle className="text-red-500" />,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mode, navigate, onError, onSuccess, setToken, setUser],
  );

  useEffect(() => {
    if (!isConfigured || isInitialized) return;

    // Store callback globally for Google to call
    window.handleGoogleCallback = handleGoogleResponse;

    // Load Google Identity Services library
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && buttonRef.current) {
        try {
          // Initialize Google
          window.google.accounts.id.initialize({
            client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
            callback: window.handleGoogleCallback!,
            auto_select: false,
            cancel_on_tap_outside: true,
          });

          // Render the button
          window.google.accounts.id.renderButton(buttonRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text:
              mode === "signin"
                ? "signin_with"
                : mode === "signup"
                  ? "signup_with"
                  : "continue_with",
            width: buttonRef.current.offsetWidth || 400,
            locale: "en",
          });

          setIsInitialized(true);
        } catch (error) {
          console.error("Failed to initialize Google Sign-In:", error);
          onError?.("Failed to initialize Google Sign-In");
        }
      }
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup
      script.remove();
      delete window.handleGoogleCallback;
    };
  }, [isConfigured, isInitialized, handleGoogleResponse, mode, onError]);

  if (!isConfigured) {
    return (
      <div className="w-full p-3 text-center border rounded-md bg-muted/50">
        <p className="text-sm text-muted-foreground">
          Google Sign-In not configured
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          See GOOGLE_OAUTH_SETUP.md for instructions
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-10 flex items-center justify-center border rounded-md">
        <span className="text-sm text-muted-foreground">
          Connecting to Google...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div ref={buttonRef} className="w-full" style={{ minHeight: "40px" }} />
      {!isInitialized && (
        <div className="w-full h-10 flex items-center justify-center border rounded-md">
          <span className="text-sm text-muted-foreground">
            Loading Google Sign-In...
          </span>
        </div>
      )}
    </div>
  );
}
