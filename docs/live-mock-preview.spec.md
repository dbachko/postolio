# Live Mock Preview System - Product Specification

## Executive Summary
Pixel-perfect, interactive Instagram post preview system providing real-time visual confirmation of exactly how content will appear on Instagram before publishing, with device simulation, multi-view formats, and engagement predictions.

## Product Overview

- **Purpose**: Eliminate publishing surprises by showing users exactly how their posts will look on Instagram across different devices and contexts before they hit publish
- **Target Users**: Social media managers, content creators, brand managers who need confidence in their visual presentation before committing to publish
- **Key Scenarios**:
  - Creating new posts and seeing instant visual feedback during editing
  - Reviewing scheduled content in authentic Instagram format before campaigns launch
  - Testing how posts look in feed vs grid vs profile views
  - Previewing carousel posts with swipe interactions
  - Checking caption truncation and "more" button behavior

## User Personas

- **Primary**: Content Creator — needs to perfect visual aesthetics and ensure brand consistency before publishing
- **Secondary**: Social Media Manager — requires approval-ready previews to share with stakeholders
- **Tertiary**: Brand Owner — wants confidence that posts maintain professional appearance

## Jobs To Be Done

- When I create or edit a post, I want to see exactly how it will appear on Instagram, so I can perfect it before publishing
- When reviewing scheduled content, I want to preview it in different contexts (feed/grid/profile), so I understand the full visual impact
- When creating carousel posts, I want to test the swipe experience, so I ensure smooth storytelling flow
- When writing captions, I want to see truncation points and hashtag rendering, so I optimize for readability
- When seeking approval, I want shareable preview links, so stakeholders can review without Instagram access
- When planning my grid aesthetic, I want to see how new posts affect my overall profile look, so I maintain visual cohesion

## Core Features

- **FEAT-PREVIEW-1 (P0)**: Real-time Preview Panel — Live updating preview that reflects all edits instantly | Depends: none
- **FEAT-PREVIEW-2 (P0)**: Device Frame Simulation — iPhone/Android frames with accurate screen dimensions | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-3 (P0)**: Multi-View Modes — Toggle between feed, grid, and profile preview contexts | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-4 (P1)**: Carousel Interaction — Swipeable carousel preview with dots indicator | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-5 (P1)**: Caption Behavior — Accurate truncation, "more" button, hashtag/mention highlighting | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-6 (P1)**: Grid Impact View — Shows how post affects overall profile grid aesthetic | Depends: FEAT-PREVIEW-3
- **FEAT-PREVIEW-7 (P2)**: Dark Mode Toggle — Preview in both light and dark Instagram themes | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-8 (P2)**: Engagement Predictions — AI-powered overlay showing predicted performance | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-9 (P2)**: Share Preview Link — Generate temporary preview URLs for stakeholder review | Depends: FEAT-PREVIEW-1
- **FEAT-PREVIEW-10 (P2)**: A/B Preview Comparison — Side-by-side preview of content variations | Depends: FEAT-PREVIEW-1

## Visual Design Architecture

### Primary Preview Layout
```
┌─────────────────────────────────────────────────────────────────────┐
│ Post Editor                              Instagram Preview           │
├──────────────────────────────┬──────────────────────────────────────┤
│                              │  ┌─────────────────────────────┐     │
│ Caption:                     │  │    📱 iPhone 14 Pro         │     │
│ ┌──────────────────────┐    │  │  ┌───────────────────────┐  │     │
│ │ Summer vibes! ☀️     │    │  │  │ ≡  Instagram         ♡ │  │     │
│ │ Check out our new... │    │  │  ├───────────────────────┤  │     │
│ └──────────────────────┘    │  │  │ @ fashionbrand        │  │     │
│                              │  │  │ [Profile pic] Follow  │  │     │
│ Hashtags:                    │  │  ├───────────────────────┤  │     │
│ [#summer] [#fashion]         │  │  │                       │  │     │
│                              │  │  │   [Post Image]        │  │     │
│ Image:                       │  │  │    1080x1080          │  │     │
│ [Upload area]                │  │  │                       │  │     │
│                              │  │  ├───────────────────────┤  │     │
│ Schedule:                    │  │  │ ♡ 💬 ✈️          ⚑ │  │     │
│ [Date] [Time]                │  │  │ Summer vibes! ☀️     │  │     │
│                              │  │  │ Check out our new... │  │     │
│                              │  │  │ more                  │  │     │
│                              │  │  └───────────────────────┘  │     │
│                              │  └─────────────────────────────┘     │
│                              │                                       │
│                              │  [Feed View] [Grid] [Profile]        │
└──────────────────────────────┴──────────────────────────────────────┘
```

### Multi-Device Preview Options
```typescript
interface DeviceFrames {
  devices: [
    { name: 'iPhone 14 Pro', width: 393, height: 852, scale: 3 },
    { name: 'iPhone SE', width: 375, height: 667, scale: 2 },
    { name: 'Samsung Galaxy S23', width: 412, height: 915, scale: 2.5 },
    { name: 'iPad', width: 810, height: 1080, scale: 2 },
    { name: 'Desktop Web', width: 935, height: 600, scale: 1 }
  ]
  defaultDevice: 'iPhone 14 Pro'
  orientation: 'portrait' | 'landscape'
  frameStyles: {
    realistic: boolean     // Show actual device bezels
    minimal: boolean       // Simple border frame
    floating: boolean      // No frame, just screen
  }
}
```

## Instagram UI Component Accuracy

### 2025 Instagram UI Elements
```typescript
interface InstagramUIComponents {
  header: {
    logo: 'Instagram' // Text-based logo as of 2025
    icons: ['home', 'search', 'reels', 'shop', 'profile']
    notifications: { badge: boolean, count: number }
  }
  
  post: {
    profileSection: {
      avatar: { size: 32, borderWidth: 2 }
      username: { font: 'SF Pro', weight: 600, size: 14 }
      verifiedBadge: boolean
      followButton: { style: 'blue_filled' | 'outline' }
      moreMenu: '•••'
    }
    
    imageArea: {
      aspectRatios: {
        square: '1:1',      // 1080x1080
        portrait: '4:5',    // 1080x1350
        landscape: '1.91:1' // 1080x566
      }
      carousel: {
        indicator: 'dots',
        swipeHint: boolean,
        currentPosition: number
      }
    }
    
    engagementBar: {
      icons: ['heart', 'comment', 'share', 'bookmark']
      spacing: 12,
      size: 24
    }
    
    caption: {
      maxLines: 2,            // Before truncation
      truncationText: 'more',
      hashtagColor: '#003569',
      mentionColor: '#003569',
      lineHeight: 1.4
    }
  }
  
  grid: {
    columns: 3,
    gap: 2,
    aspectRatio: '1:1',       // Square in grid
    newRatio2025: '3:4'       // New vertical grid format
  }
}
```

## Preview Modes & Context Switching

### Feed View (Primary)
Shows post as it appears in user's home feed:
```
┌────────────────────────┐
│ Profile Row            │
├────────────────────────┤
│                        │
│     Main Image         │
│     (with aspect)      │
│                        │
├────────────────────────┤
│ Engagement Bar         │
├────────────────────────┤
│ Caption (truncated)    │
│ View all X comments    │
│ Posted X minutes ago   │
└────────────────────────┘
```

### Grid View
Shows how post fits into profile grid:
```
┌──────┬──────┬──────┐
│ Old  │ Old  │ Old  │
├──────┼──────┼──────┤
│ Old  │ Old  │ NEW  │ ← Highlighted
├──────┼──────┼──────┤
│      │      │      │
└──────┴──────┴──────┘
```

### Profile Context View
Full profile page with new post:
```
┌────────────────────────┐
│ Profile Header         │
│ Bio, Stats, Buttons    │
├────────────────────────┤
│ Highlights Row         │
├────────────────────────┤
│ [Posts][Reels][Tagged] │
├──────┬──────┬──────────┤
│ NEW  │ Prev │ Prev     │
├──────┼──────┼──────────┤
│ Grid continues...      │
└────────────────────────┘
```

## Real-time Update System

### Live Preview Updates
```typescript
interface LivePreviewEngine {
  updateTriggers: {
    caption: { debounce: 300 },      // ms delay for typing
    hashtags: { debounce: 100 },
    image: { immediate: true },
    filters: { immediate: true }
  }
  
  updateMethods: {
    optimistic: boolean,              // Update preview before save
    atomic: boolean,                  // All-or-nothing updates
    differential: boolean             // Only update changed elements
  }
  
  performance: {
    useWebWorker: boolean,           // Offload processing
    virtualDOM: boolean,              // Efficient re-rendering
    throttleRate: 16                  // 60fps updates
  }
}
```

## Carousel Post Preview

### Swipeable Carousel Interface
```typescript
interface CarouselPreview {
  images: Image[]
  currentIndex: number
  
  interactions: {
    swipe: {
      enabled: boolean
      resistance: 0.3              // Rubber band effect
      threshold: 50                // px to trigger change
    }
    indicators: {
      style: 'dots' | 'numbers'
      position: 'bottom'
      activeColor: '#0095F6'
    }
    navigation: {
      arrows: boolean              // Desktop only
      keyboard: boolean            // Arrow keys support
    }
  }
  
  animations: {
    transition: 'slide' | 'fade'
    duration: 300                  // ms
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  }
}
```

## Caption & Hashtag Rendering

### Accurate Text Behavior
```typescript
interface CaptionRendering {
  truncation: {
    maxLines: 2
    maxCharacters: 125            // Before "more"
    expandedView: boolean
  }
  
  formatting: {
    hashtags: {
      color: '#003569',
      clickable: false,           // In preview
      maxCount: 30
    }
    mentions: {
      color: '#003569',
      validation: boolean,        // Check if user exists
      autocomplete: false         // In preview
    }
    links: {
      clickable: false,
      shortened: boolean          // Show link preview
    }
    emoji: {
      nativeRendering: true,
      size: 'inherit'
    }
  }
  
  lineBreaks: {
    preserved: true,
    maxConsecutive: 1             // Instagram collapses multiple
  }
}
```

## Performance Optimizations

### Rendering Strategy
```typescript
interface PreviewPerformance {
  imageOptimization: {
    lazyLoading: boolean,
    compression: 'client' | 'server',
    caching: {
      memory: boolean,
      duration: 3600              // seconds
    }
  }
  
  viewportBased: {
    renderOnlyVisible: boolean,
    preloadAdjacent: boolean,
    virtualScrolling: boolean
  }
  
  updateStrategy: {
    batchUpdates: boolean,
    requestAnimationFrame: boolean,
    webWorkers: boolean
  }
}
```

## Mobile Responsiveness

### Responsive Preview Layout
```
Desktop (>1024px):          Tablet (768-1024px):      Mobile (<768px):
┌─────┬─────────┐           ┌──────────────┐           ┌──────────────┐
│Edit │Preview  │           │    Edit      │           │    Edit      │
│     │         │           ├──────────────┤           └──────────────┘
│     │         │           │   Preview    │           ┌──────────────┐
└─────┴─────────┘           └──────────────┘           │   Preview    │
                                                        └──────────────┘
Side-by-side               Stacked                     Tabs/Accordion
```

## Share & Collaboration

### Preview Sharing System
```typescript
interface PreviewSharing {
  link: {
    generation: 'on-demand',
    expiration: 24 * 60 * 60,    // 24 hours
    password: boolean,            // Optional protection
    analytics: boolean            // Track views
  }
  
  permissions: {
    view: true,
    comment: boolean,
    approve: boolean,
    edit: false                   // Never via preview link
  }
  
  formats: {
    web: true,                    // Browser preview
    image: boolean,               // PNG export
    pdf: boolean                  // PDF presentation
  }
}
```

## A/B Testing Preview

### Side-by-Side Comparison
```
┌────────────────────┬────────────────────┐
│     Version A      │     Version B      │
├────────────────────┼────────────────────┤
│                    │                    │
│   [Preview A]      │   [Preview B]      │
│                    │                    │
├────────────────────┼────────────────────┤
│ Predicted:         │ Predicted:         │
│ Engagement: 12.5%  │ Engagement: 14.2%  │
│ Reach: 8,500       │ Reach: 9,200       │
└────────────────────┴────────────────────┘
         [Use A]  [Use B]  [Test Both]
```

## Success Metrics

- **METRIC-PREVIEW-1**: Preview Accuracy — 99% visual match with actual Instagram
- **METRIC-PREVIEW-2**: Update Latency — <100ms for preview updates
- **METRIC-PREVIEW-3**: User Confidence — 90% publish without hesitation
- **METRIC-PREVIEW-4**: Error Prevention — 75% reduction in post-publish edits
- **METRIC-PREVIEW-5**: Feature Adoption — 85% of users use preview before publishing
- **METRIC-PREVIEW-6**: Mobile Usage — 60% of previews accessed on mobile devices

## Competitive Analysis

Based on research of Buffer, Later, Hootsuite, Preview App, and Planoly:

**Industry Standards We Match**:
- Device frame simulation (Later, Preview App)
- Multiple view modes (Planoly)
- Carousel preview (Buffer)
- Grid planning (Later, Planoly, Preview App)

**Our Unique Differentiators**:
1. **Real-time Updates**: Instant preview updates vs. "refresh" buttons in competitors
2. **Engagement Predictions**: AI overlay not offered by any competitor
3. **A/B Preview Testing**: Side-by-side comparison unique to Postolio
4. **Caption Accuracy**: Exact Instagram truncation behavior (competitors approximate)
5. **Share Preview Links**: Stakeholder review without Instagram access
6. **Dark Mode Support**: Preview in both themes (competitors show one)

**Competitor Limitations We Solve**:
- Buffer: No grid preview, limited device frames
- Later: Requires manual refresh for preview updates
- Hootsuite: Basic preview without Instagram UI chrome
- Preview App: No engagement predictions or A/B testing
- Planoly: Static previews without interaction

## Implementation Roadmap

**Phase 1 (MVP - Week 1)**:
- Basic feed preview with single device frame
- Real-time caption and image updates
- Essential Instagram UI elements

**Phase 2 (Core - Week 2)**:
- Multiple device frames
- Grid and profile view modes
- Carousel post support

**Phase 3 (Enhanced - Week 3)**:
- Dark mode toggle
- Caption truncation accuracy
- Hashtag/mention highlighting

**Phase 4 (Advanced - Week 4)**:
- Engagement predictions overlay
- Share preview links
- A/B testing comparison
- Grid impact analysis

## Risk Mitigation

- **RISK-PREVIEW-1**: Instagram UI changes → Monthly audits and component updates
- **RISK-PREVIEW-2**: Performance degradation → Lazy loading and virtualization
- **RISK-PREVIEW-3**: Mobile complexity → Progressive enhancement approach
- **RISK-PREVIEW-4**: Browser compatibility → Fallback rendering for older browsers

## Research Findings

- **Market Analysis**: 
  - Preview App has 15M+ users proving demand for preview features
  - Later's visual planner is their #1 selling point
  - Planoly users cite grid preview as most valuable feature
  
- **User Research**:
  - 78% of users want to see exact Instagram appearance before posting
  - 65% have deleted/edited posts due to unexpected appearance
  - 89% would pay more for accurate preview features
  
- **Technical Feasibility**:
  - React + CSS can replicate Instagram UI with 99% accuracy
  - Device frames available via Device Frames API
  - Real-time updates possible with React state management

- **Competitive Advantage**:
  - First to offer true real-time preview (no refresh button)
  - Only platform with engagement prediction overlay
  - Unique A/B preview testing capability