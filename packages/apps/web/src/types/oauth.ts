// Google OAuth Types
export interface GoogleCredentialResponse {
  credential: string
  select_by?: string
  clientId?: string
}

export interface GoogleAccountsId {
  initialize: (config: GoogleInitializeConfig) => void
  renderButton: (element: HTMLElement, options: GoogleButtonOptions) => void
  prompt: () => void
  disableAutoSelect: () => void
}

export interface GoogleInitializeConfig {
  client_id: string
  callback: (response: GoogleCredentialResponse) => void
  auto_select?: boolean
  cancel_on_tap_outside?: boolean
  context?: 'signin' | 'signup' | 'use'
  ux_mode?: 'popup' | 'redirect'
  login_uri?: string
  native_callback?: (response: GoogleCredentialResponse) => void
}

export interface GoogleButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number | string
  locale?: string
}

export interface GoogleAccounts {
  accounts: {
    id: GoogleAccountsId
  }
}

// Facebook OAuth Types
export interface FacebookAuthResponse {
  accessToken: string
  userID: string
  expiresIn?: number
  signedRequest?: string
  graphDomain?: string
  data_access_expiration_time?: number
}

export interface FacebookLoginResponse {
  authResponse?: FacebookAuthResponse
  status: 'connected' | 'not_authorized' | 'unknown'
}

export interface FacebookLoginOptions {
  scope?: string
  return_scopes?: boolean
  enable_profile_selector?: boolean
  auth_type?: string
}

export interface FacebookInitOptions {
  appId: string
  cookie?: boolean
  xfbml?: boolean
  version: string
  autoLogAppEvents?: boolean
  status?: boolean
  frictionlessRequests?: boolean
}

export interface FacebookSDK {
  init: (options: FacebookInitOptions) => void
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options?: FacebookLoginOptions
  ) => void
  logout: (callback: (response: unknown) => void) => void
  getLoginStatus: (
    callback: (response: FacebookLoginResponse) => void,
    force?: boolean
  ) => void
  api: (
    path: string,
    method: string,
    params: Record<string, unknown>,
    callback: (response: unknown) => void
  ) => void
}

// Window augmentation
declare global {
  interface Window {
    google?: GoogleAccounts
    FB?: FacebookSDK
    fbAsyncInit?: () => void
    handleGoogleCallback?: (response: GoogleCredentialResponse) => void
    handleFacebookResponse?: (response: FacebookAuthResponse) => void
  }
}