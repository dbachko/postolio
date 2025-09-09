// Email validation - simple regex without over-engineering
export function validateEmail(email: string): boolean {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

// Password validation with minimum length and complexity for < 15 chars
export function validatePassword(password: string): {
  valid: boolean;
  message?: string;
} {
  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters",
    };
  }

  // Enforce complexity for passwords under 15 characters
  if (password.length < 15) {
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    // eslint-disable-next-line no-useless-escape
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    const complexityCount = [hasUpper, hasLower, hasNumber, hasSymbol].filter(
      Boolean,
    ).length;
    if (complexityCount < 3) {
      return {
        valid: false,
        message:
          "Add 3 of: uppercase, lowercase, number, symbol (or use 15+ chars)",
      };
    }
  }

  return { valid: true };
}

// Password strength levels
export type PasswordLevel = "weak" | "fair" | "good" | "strong" | "excellent";

export interface PasswordStrength {
  level: PasswordLevel;
  message: string;
  showComplexityRules: boolean;
  progress: number; // 0-100 for progress bar
}

// Dynamic password strength based on NIST 2024 guidelines
// At 15+ chars, no complexity requirements needed (70+ bits entropy)
export function getPasswordStrength(password: string): PasswordStrength {
  const length = password.length;

  if (length < 8) {
    return {
      level: "weak",
      message: "Too short - min 8 characters",
      showComplexityRules: true,
      progress: (length / 8) * 20,
    };
  }

  if (length < 12) {
    return {
      level: "fair",
      message: "Add complexity or use 15+ chars",
      showComplexityRules: true,
      progress: 20 + ((length - 8) / 4) * 20,
    };
  }

  if (length < 15) {
    const remaining = 15 - length;
    return {
      level: "good",
      message: `${remaining} more char${remaining > 1 ? "s" : ""} removes requirements!`,
      showComplexityRules: true,
      progress: 40 + ((length - 12) / 3) * 20,
    };
  }

  if (length < 20) {
    return {
      level: "strong",
      message: "✨ Great! No special chars needed",
      showComplexityRules: false,
      progress: 60 + ((length - 15) / 5) * 20,
    };
  }

  return {
    level: "excellent",
    message: "🎉 Excellent passphrase!",
    showComplexityRules: false,
    progress: 100,
  };
}

// Get color for password strength level
export function getStrengthColor(level: PasswordLevel): string {
  const colors = {
    weak: "#EF4444", // Red
    fair: "#F59E0B", // Orange
    good: "#EAB308", // Yellow
    strong: "#84CC16", // Light Green
    excellent: "#10B981", // Green
  };
  return colors[level];
}

// Form validation rules for react-hook-form
export const validationRules = {
  email: {
    required: "Email is required",
    validate: (value: string) =>
      validateEmail(value) || "Please enter a valid email address",
  },
  password: {
    required: "Password is required",
    minLength: {
      value: 8,
      message: "Password must be at least 8 characters",
    },
    validate: (value: string) => {
      const result = validatePassword(value);
      return result.valid || result.message;
    },
  },
  name: {
    required: false, // Make name optional in progressive disclosure
    minLength: {
      value: 2,
      message: "Name must be at least 2 characters",
    },
    maxLength: {
      value: 100,
      message: "Name must be less than 100 characters",
    },
  },
};
