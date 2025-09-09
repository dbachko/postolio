import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { TIMEOUTS } from "@/constants/timeouts";

export function MagicLinkVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser, setToken } = useAuthStore();

  const [status, setStatus] = useState<"verifying" | "success" | "error">(
    "verifying",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("No verification token provided");
      return;
    }

    verifyMagicLink(token);
  }, [token]);

  const verifyMagicLink = async (token: string) => {
    try {
      const response = await fetch("/api/auth/magic-link/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to verify magic link");
      }

      // Store auth data
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("token", data.token);

      setStatus("success");

      toast.success("Successfully signed in!", {
        description: "Welcome to Postolio! Redirecting to dashboard...",
        icon: <CheckCircle className="text-green-500" />,
        duration: TIMEOUTS.TOAST_DURATION,
      });

      setTimeout(() => {
        navigate("/dashboard");
      }, TIMEOUTS.SUCCESS_REDIRECT);
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to verify magic link",
      );

      toast.error("Verification failed", {
        description: errorMessage,
        icon: <XCircle className="text-red-500" />,
      });
    }
  };

  const handleRetry = () => {
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">
              {status === "verifying" && "Verifying your magic link..."}
              {status === "success" && "Success!"}
              {status === "error" && "Verification failed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === "verifying" && (
              <div className="flex flex-col items-center space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground text-center">
                  Please wait while we verify your magic link...
                </p>
              </div>
            )}

            {status === "success" && (
              <div className="flex flex-col items-center space-y-4">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <p className="text-center">
                  You've been successfully signed in!
                  <br />
                  Redirecting to your dashboard...
                </p>
              </div>
            )}

            {status === "error" && (
              <>
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>

                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    The magic link may have expired or already been used. Please
                    request a new one.
                  </p>

                  <Button onClick={handleRetry} className="w-full">
                    Back to sign in
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="py-6 px-4 border-t">
        <div className="flex justify-center items-center text-sm text-muted-foreground space-x-4">
          <span>© {new Date().getFullYear()} Postolio</span>
        </div>
      </footer>
    </div>
  );
}
