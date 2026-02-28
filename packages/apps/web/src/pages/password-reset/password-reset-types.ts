export interface PasswordStrength {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
}

export const EMPTY_PASSWORD_STRENGTH: PasswordStrength = {
  length: false,
  uppercase: false,
  lowercase: false,
  number: false,
};

export function hasStrongPassword(strength: PasswordStrength): boolean {
  return Object.values(strength).every(Boolean);
}
