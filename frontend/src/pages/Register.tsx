import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useAuthStore } from '../stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter'
import { FormField } from '@/components/forms/FormField'
import { GoogleSignInIsolated } from '@/components/auth/GoogleSignInIsolated'
import { FacebookSignInIsolated } from '@/components/auth/FacebookSignInIsolated'
import { MagicLinkForm } from '@/components/auth/MagicLinkForm'
import { validationRules } from '../utils/validation'
import { TIMEOUTS } from '../constants/timeouts'
import { Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface RegisterFormData {
  email: string
  password: string
  name: string
}

export function Register() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showMagicLink, setShowMagicLink] = useState(false)
  
  const { register: registerUser } = useAuthStore()
  const navigate = useNavigate()
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch
  } = useForm<RegisterFormData>({
    mode: 'onChange', // Real-time validation
    reValidateMode: 'onChange'
  })
  
  const password = watch('password', '')

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true)
    setError('')

    try {
      await registerUser(data.email, data.password, data.name)
      toast.success('Account created successfully!', {
        description: 'Welcome to Postolio! Redirecting to dashboard...',
        icon: <CheckCircle className="text-green-500" />,
        duration: TIMEOUTS.TOAST_DURATION,
      })
      setTimeout(() => navigate('/dashboard'), TIMEOUTS.SUCCESS_REDIRECT)
    } catch (error: unknown) {
      // Type-safe error handling
      const apiError = error as { response?: { data?: { message?: string } }; message?: string }
      const message = apiError?.response?.data?.message || 
                     apiError?.message || 
                     'Registration failed. Please try again.'
      setError(message)
      toast.error('Registration failed', {
        description: message,
        icon: <AlertCircle className="text-red-500" />,
        duration: TIMEOUTS.TOAST_DURATION,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Main content */}
      <div className="flex-1 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl text-center">Create your account</CardTitle>
            <CardDescription className="text-center">
              Or{' '}
              <Link
                to="/login"
                className="font-medium text-primary hover:underline"
              >
                sign in to your existing account
              </Link>
            </CardDescription>
          </CardHeader>
        <CardContent>
          {/* OAuth Providers */}
          <div className="space-y-3 mb-6">
            <GoogleSignInIsolated mode="signup" />
            <FacebookSignInIsolated mode="signup" />
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
              <MagicLinkForm mode="signup" onSuccess={() => navigate('/dashboard')} />
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
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            {/* Name Field - Optional, moved to progressive disclosure */}
            <FormField
              label="Full Name"
              htmlFor="name"
              error={errors.name?.message}
              required={false}
            >
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Enter your full name"
                {...register('name', validationRules.name)}
                aria-invalid={!!errors.name}
              />
            </FormField>
            
            {/* Email Field with validation */}
            <FormField
              label="Email address"
              htmlFor="email"
              error={errors.email?.message}
              required={true}
            >
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck="false"
                autoCapitalize="off"
                placeholder="Enter your email"
                {...register('email', validationRules.email)}
                aria-invalid={!!errors.email}
                className={errors.email ? 'border-red-500' : ''}
              />
            </FormField>
            
            {/* Password Field with strength meter */}
            <FormField
              label="Password"
              htmlFor="password"
              error={errors.password?.message}
              required={true}
            >
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Enter password or passphrase"
                  {...register('password', validationRules.password)}
                  aria-invalid={!!errors.password}
                  className={errors.password ? 'border-red-500' : ''}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <PasswordStrengthMeter password={password} />
            </FormField>
            
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
            
            {/* Magic Link Alternative */}
            <div className="text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowMagicLink(true)}
              >
                Or sign up with magic link (no password)
              </Button>
            </div>
            
            {/* Privacy Policy Notice */}
            <div className="text-xs text-center text-muted-foreground mt-4">
              By creating an account, you agree to our{' '}
              <Link 
                to="/privacy-policy" 
                className="text-primary hover:underline"
              >
                Privacy Policy
              </Link>
              {' '}and{' '}
              <Link 
                to="/terms-of-service" 
                className="text-primary hover:underline"
              >
                Terms of Service
              </Link>
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
  )
}