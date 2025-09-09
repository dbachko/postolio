import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleSignInIsolated } from "@/components/auth/GoogleSignInIsolated";
import { FacebookSignInIsolated } from "@/components/auth/FacebookSignInIsolated";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showMagicLink, setShowMagicLink] = useState(false);

  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      await login(email, password, rememberMe);
      navigate("/dashboard");
    } catch {
      setError("Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">
              Sign in to your account
            </CardTitle>
            <CardDescription className="text-center">
              Or{" "}
              <Link
                to="/register"
                className="font-medium text-primary hover:underline"
              >
                create a new account
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* OAuth Providers */}
            <div className="space-y-3 mb-6">
              <GoogleSignInIsolated mode="signin" />
              <FacebookSignInIsolated mode="signin" />
            </div>

            {/* Divider */}
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            {/* Magic Link Option */}
            {showMagicLink ? (
              <>
                <MagicLinkForm
                  mode="signin"
                  onSuccess={() => navigate("/dashboard")}
                />
                <div className="text-center mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMagicLink(false)}
                  >
                    Use email and password instead
                  </Button>
                </div>
              </>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      to="/password/reset"
                      className="text-sm text-primary hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) =>
                      setRememberMe(checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="remember"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Remember me for 30 days
                  </Label>
                </div>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? "Signing in..." : "Sign in"}
                </Button>

                {/* Magic Link Alternative */}
                <div className="text-center mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMagicLink(true)}
                  >
                    Or sign in with magic link (no password)
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="py-6 px-4 border-t">
        <div className="flex justify-center items-center text-sm text-muted-foreground space-x-4">
          <span>© {new Date().getFullYear()} Postolio</span>
          <span>•</span>
          <Link
            to="/privacy-policy"
            className="hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
          <span>•</span>
          <Link
            to="/terms-of-service"
            className="hover:text-foreground transition-colors"
          >
            Terms of Service
          </Link>
          <span>•</span>
          <a
            href="mailto:legal@postolio.example"
            className="hover:text-foreground transition-colors"
          >
            Legal
          </a>
        </div>
      </footer>
    </div>
  );
}
