import { describe, it, expect } from 'vitest';
import { runEngagementCorrelationFromPosts } from './engagement-correlation';

describe('engagement correlation', () => {
  it('detects positive delta for hashtags when engagement higher', () => {
    const posts = [
      { hashtags: ['a'], like_count: 10, comments_count: 5 },
      { hashtags: ['b'], like_count: 12, comments_count: 3 },
      { hashtags: [], like_count: 3, comments_count: 1 },
      { hashtags: [], like_count: 4, comments_count: 1 },
    ];
    const findings = runEngagementCorrelationFromPosts(posts, 0.1);
    expect(findings.find((f) => f.feature === 'has_hashtags')).toBeTruthy();
  });
});
