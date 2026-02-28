type ThemeSuggestionLike = { value: string };

export function clampSuggestions<T extends ThemeSuggestionLike>(
  suggestions: T[],
  limit: number,
  userThemeCount: number
): T[] {
  const maxResults = Math.max(limit, userThemeCount);
  return suggestions
    .filter((suggestion) => suggestion.value && suggestion.value.length >= 2)
    .slice(0, Math.max(1, Math.min(16, maxResults || limit)));
}
