export const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'every2days', label: 'Every 2 Days' },
  { value: '3weekly', label: '3x Weekly' },
];

export const styleOptions = [
  { value: 'modern', label: 'Modern & Minimalist' },
  { value: 'vibrant', label: 'Vibrant & Colorful' },
  { value: 'professional', label: 'Professional & Corporate' },
  { value: 'casual', label: 'Casual & Friendly' },
  { value: 'luxury', label: 'Luxury & Premium' },
  { value: 'vintage', label: 'Vintage & Retro' },
];

// Optional metadata for richer UI presentation (icons + blurbs)
// Consumers should continue to rely on `styleOptions` for values/labels.
export const styleMeta: Record<string, { icon: string; blurb: string }> = {
  modern: { icon: '✨', blurb: 'Clean, minimalist layouts' },
  vibrant: { icon: '🌈', blurb: 'Bold, colorful visuals' },
  professional: { icon: '🏢', blurb: 'Structured, corporate tone' },
  casual: { icon: '😊', blurb: 'Friendly, approachable voice' },
  luxury: { icon: '💎', blurb: 'Premium, high-end feel' },
  vintage: { icon: '📻', blurb: 'Retro, nostalgic style' },
};

export const commonThemes = [
  'product showcase',
  'behind the scenes',
  'customer stories',
  'tips & tutorials',
  'industry insights',
  'company culture',
  'seasonal content',
  'user generated content',
];

export const themeMeta: Record<string, { icon?: string; help?: string }> = {
  'product showcase': { icon: '🛍️', help: 'Highlight products and features' },
  'behind the scenes': { icon: '🎬', help: 'Show process and team moments' },
  'customer stories': { icon: '💬', help: 'Share testimonials and wins' },
  'tips & tutorials': { icon: '📚', help: 'Educate with how-tos and tips' },
  'industry insights': { icon: '📈', help: 'Commentary on trends and news' },
  'company culture': { icon: '🏠', help: 'People, values, and culture' },
  'seasonal content': { icon: '🍂', help: 'Holidays and seasonal themes' },
  'user generated content': { icon: '🤝', help: 'Reshare community content' },
};
