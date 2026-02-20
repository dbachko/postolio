import type { AssetFormState } from './types';

export const IMAGE_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
export const VIDEO_UPLOAD_LIMIT_BYTES = 500 * 1024 * 1024;

export const DEFAULT_FORM_STATE: AssetFormState = {
  title: '',
  description: '',
  altText: '',
};
