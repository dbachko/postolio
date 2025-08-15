# Postolio - Frontend

React TypeScript frontend for the Postolio platform. Provides a modern web interface for content generation, brand management, and approval workflows.

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for utility-first styling
- **TanStack Query** for API state management
- **Zustand** for client-side state management
- **React Router** for navigation

## Features

- 🔐 User authentication with JWT
- 📊 Dashboard with content approval overview
- 🏢 Brand management and creation
- 🤖 AI content generation interface
- ✅ Content approval workflow with scheduling
- 📷 Instagram API integration and posting
- 📈 Analytics dashboard with performance metrics
- ⏰ Smart scheduling with optimal timing recommendations
- 📊 Engagement tracking and trend analysis
- 📱 Responsive design for all devices

## Development

### Prerequisites

- Node.js 20+
- Backend API running on `http://localhost:3000`

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Available Scripts

```bash
# Development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run ESLint
npm run lint
```

### Environment Configuration

The frontend connects to the backend API at `http://localhost:3000` by default. This can be configured in `src/lib/api.ts`.

## Project Structure

```
src/
├── components/             # Reusable UI components
│   ├── ContentCard.tsx     # Content approval card
│   ├── Layout.tsx          # Main layout with navigation
│   ├── AnalyticsChart.tsx  # Analytics visualization components
│   └── SchedulingPanel.tsx # Scheduling management interface
├── pages/                  # Page components
│   ├── Dashboard.tsx       # Main dashboard
│   ├── Login.tsx           # Login page
│   ├── Register.tsx        # Registration page
│   ├── Brands.tsx          # Brand management
│   ├── Content.tsx         # Content management
│   └── Analytics.tsx       # Analytics & scheduling dashboard
├── stores/                 # Zustand state stores
│   └── authStore.ts        # Authentication state
├── lib/                    # Utilities and services
│   └── api.ts              # Type-safe API client
└── App.tsx                 # Main app with routing
```

## Key Components

### Authentication Store

Zustand store managing user authentication state:

```typescript
const { user, login, logout, checkAuth } = useAuthStore()
```

### API Client

Type-safe API client with automatic token handling:

```typescript
import { apiClient } from '../lib/api'

// Automatically includes JWT token in requests
const brands = await apiClient.getBrands()
```

### Content Card

Reusable component for content approval workflow:

```typescript
<ContentCard 
  content={contentItem} 
  brandId={brandId} 
/>
```

### Analytics Components

Interactive components for analytics and scheduling:

```typescript
// Analytics charts for engagement trends
<AnalyticsChart 
  title="Engagement Trends" 
  data={engagementData} 
  type="engagement" 
/>

// Scheduling management panel
<SchedulingPanel 
  scheduledPosts={posts} 
  onCancelPost={handleCancel}
  onReschedulePost={handleReschedule} 
/>
```

## Styling

Using Tailwind CSS with custom configuration:

- **Colors**: Blue theme for primary actions
- **Typography**: Clean, modern font stack
- **Responsive**: Mobile-first design approach
- **Components**: Card-based layouts for content

## State Management

- **TanStack Query**: Server state, caching, and synchronization
- **Zustand**: Client-side authentication state
- **React Router**: Navigation and route protection

## API Integration

The frontend integrates with these backend endpoints:

- **Auth**: `/auth/login`, `/auth/register`, `/auth/me`
- **Brands**: `/brands/list`, `/brands/create`, `/brands/analyze`
- **Content**: `/content/generate`, `/content/approve`, `/content/draft`
- **Instagram**: `/instagram/profile`, `/instagram/connect`, `/instagram/publish`
- **Analytics**: `/analytics/report`, `/analytics/optimal-times`, `/analytics/schedule`

## Production Build

```bash
# Build for production
npm run build

# The dist/ folder contains the built application
# Serve with any static file server
```

## Deployment

The built application can be deployed to any static hosting service:

- **Vercel**: `vercel --prod`
- **Netlify**: Deploy `dist/` folder
- **AWS S3**: Upload `dist/` contents
- **GitHub Pages**: Deploy from `gh-pages` branch

Make sure to configure the API base URL for your production backend.
