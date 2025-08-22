import { GoogleLogin } from '@react-oauth/google'
import type { CredentialResponse } from '@react-oauth/google'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, AlertCircle } from 'lucide-react'
import { TIMEOUTS } from '@/constants/timeouts'

interface GoogleSignInProps {
  mode: 'signin' | 'signup' | 'link'
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function GoogleSignIn({ mode, onSuccess, onError }: GoogleSignInProps) {
  const [isLoading, setIsLoading] = useState(false)
  const { setUser, setToken } = useAuthStore()
  const navigate = useNavigate()

  const handleGoogleResponse = useCallback(async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      const errorMsg = 'No credential received from Google'
      onError?.(errorMsg)
      toast.error('Google sign-in failed', {
        description: errorMsg,
        icon: <AlertCircle className="text-red-500" />,
      })
      return
    }

    setIsLoading(true)
    
    try {
      const endpoint = mode === 'link' ? '/api/auth/google/link' : '/api/auth/google/verify'
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(mode === 'link' && localStorage.getItem('token') 
            ? { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            : {})
        },
        credentials: 'include', // Include cookies
        body: JSON.stringify({
          credential: credentialResponse.credential
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Google authentication failed')
      }

      if (mode !== 'link') {
        // Store auth data
        setToken(data.token)
        setUser(data.user)
        localStorage.setItem('token', data.token)
        
        const actionText = data.isNewUser ? 'Account created' : 'Signed in'
        toast.success(`${actionText} successfully!`, {
          description: 'Welcome to Postolio! Redirecting...',
          icon: <CheckCircle className="text-green-500" />,
          duration: TIMEOUTS.TOAST_DURATION,
        })
        
        setTimeout(() => {
          navigate('/dashboard')
        }, TIMEOUTS.SUCCESS_REDIRECT)
      } else {
        toast.success('Google account linked!', {
          description: 'You can now sign in with Google',
          icon: <CheckCircle className="text-green-500" />,
        })
      }
      
      onSuccess?.()
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Google authentication failed'
      onError?.(errorMsg)
      toast.error('Authentication failed', {
        description: errorMsg,
        icon: <AlertCircle className="text-red-500" />,
      })
    } finally {
      setIsLoading(false)
    }
  }, [mode, navigate, onError, onSuccess, setToken, setUser])

  const handleError = () => {
    const errorMsg = 'Google sign-in was cancelled or failed'
    onError?.(errorMsg)
    toast.error('Sign-in failed', {
      description: errorMsg,
      icon: <AlertCircle className="text-red-500" />,
    })
  }

  const buttonText = {
    signin: 'signin_with',
    signup: 'signup_with',
    link: 'continue_with'
  }[mode]

  if (isLoading) {
    return (
      <div className="w-full h-10 flex items-center justify-center border rounded-md">
        <span className="text-sm text-muted-foreground">Connecting to Google...</span>
      </div>
    )
  }

  return (
    <div className="w-full flex justify-center">
      <GoogleLogin
        onSuccess={handleGoogleResponse}
        onError={handleError}
        text={buttonText as 'signin_with' | 'signup_with' | 'continue_with'}
        width="100%"
        theme="outline"
        size="large"
        shape="rectangular"
        locale="en"
      />
    </div>
  )
}