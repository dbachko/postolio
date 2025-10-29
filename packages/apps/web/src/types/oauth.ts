// Google GIS types removed — we now use @react-oauth/google (auth-code flow)

// Facebook OAuth Types
export interface FacebookAuthResponse {
  accessToken: string;
  userID: string;
  expiresIn?: number;
  signedRequest?: string;
  graphDomain?: string;
  data_access_expiration_time?: number;
}

export interface FacebookLoginResponse {
  authResponse?: FacebookAuthResponse;
  status: 'connected' | 'not_authorized' | 'unknown';
}

export interface FacebookLoginOptions {
  scope?: string;
  return_scopes?: boolean;
  enable_profile_selector?: boolean;
  auth_type?: string;
}

export interface FacebookInitOptions {
  appId: string;
  cookie?: boolean;
  xfbml?: boolean;
  version: string;
  autoLogAppEvents?: boolean;
  status?: boolean;
  frictionlessRequests?: boolean;
}

export interface FacebookSDK {
  init: (options: FacebookInitOptions) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options?: FacebookLoginOptions
  ) => void;
  logout: (callback: (response: unknown) => void) => void;
  getLoginStatus: (callback: (response: FacebookLoginResponse) => void, force?: boolean) => void;
  api: (
    path: string,
    method: string,
    params: Record<string, unknown>,
    callback: (response: unknown) => void
  ) => void;
}

// Window augmentation
declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
    handleFacebookResponse?: (response: FacebookAuthResponse) => void;
  }
}
