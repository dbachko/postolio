# Instagram AI Agency

A full-stack application for automated Instagram content generation and management using AI. The platform analyzes brand styles, generates personalized content, and provides an approval workflow for social media managers.

> **⚠️ Important Update**: As of December 4, 2024, Instagram Basic Display API has been deprecated. This application now uses the **Instagram Graph API**, which requires Instagram Business or Creator accounts connected to Facebook Pages. Personal Instagram accounts are no longer supported.

## Architecture

- **Backend**: Fastify TypeScript server with Prisma ORM and PostgreSQL
- **Frontend**: React TypeScript with Vite, TanStack Query, and Tailwind CSS
- **AI Services**: OpenAI GPT-4o for content generation and DALL-E 3 for images
- **Database**: PostgreSQL with Docker containerization
- **Authentication**: JWT-based authentication system

## Features

- ✅ User authentication and account management
- ✅ Brand analysis and style learning from Instagram posts
- ✅ AI-powered content generation (captions, hashtags, images)
- ✅ Content approval workflow with scheduling
- ✅ Instagram Graph API integration with automated posting (Business/Creator accounts)
- ✅ OAuth 2.0 flow for secure Instagram account connection
- ✅ Analytics and optimal posting times with performance tracking
- ✅ Responsive web dashboard with analytics interface
- 🚧 Engagement automation (upcoming)

## Quick Start

### Prerequisites

- Node.js 20+ 
- Docker and Docker Compose
- OpenAI API key
- Instagram Business or Creator account linked to a Facebook Page
- Meta Developer account for Instagram Graph API access

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd ai-agency

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Environment Setup

Copy the example environment file and configure your credentials:

```bash
cp .env.example .env
```

Edit the `.env` file with your actual credentials (see detailed setup instructions below).

#### Required API Keys

1. **OpenAI API Key** (required for AI content generation)
2. **Meta App Credentials** (required for Instagram integration)

See the [API Setup Guide](#api-setup-guide) below for detailed instructions.

### 3. Start Services

#### Option A: Full Development Setup

```bash
# Terminal 1: Start PostgreSQL database
docker-compose up -d

# Terminal 2: Start backend server
npm run dev

# Terminal 3: Start frontend development server
cd frontend
npm run dev
```

#### Option B: Quick Start Script

```bash
# Start all services with one command
npm run start:all
```

### 4. Database Setup

```bash
# Run database migrations
npx prisma migrate dev

# Optional: View database in Prisma Studio
npx prisma studio
```

### 5. Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **API Health Check**: http://localhost:3000/health
- **Prisma Studio**: http://localhost:5555

## API Setup Guide

### OpenAI API Setup

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key and add it to your `.env` file:
   ```bash
   OPENAI_API_KEY="sk-your-openai-api-key-here"
   ```

### Instagram Integration Setup

To enable Instagram publishing and OAuth authentication, you need to create a Meta App with Instagram Graph API. 

**Important**: As of December 4, 2024, Instagram Basic Display API has been deprecated. This integration uses the Instagram Graph API, which requires Instagram Business or Creator accounts.

#### Step 1: Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click **"My Apps"** → **"Create App"**
3. Choose **"Business"** as the app type
4. Fill in your app details:
   - **App Name**: "AI Agency Instagram Integration" (or your preferred name)
   - **Contact Email**: Your email address
   - **Business Account**: Create or select an existing one

#### Step 2: Add Instagram Graph API Product

1. In your app dashboard, click **"Add Product"**
2. Find **"Instagram Graph API"** and click **"Set Up"**
3. Go to **Instagram Graph API** → **Getting Started**

#### Step 3: Configure Facebook Login Product

Since Instagram Graph API uses Facebook Login for authentication, you need to add this product:

1. Click **"Add Product"** and find **"Facebook Login"**
2. Click **"Set Up"** for Facebook Login
3. Go to **Facebook Login** → **Settings**
4. Add the following to **Valid OAuth Redirect URIs**:
   ```
   http://localhost:3000/auth/instagram/callback
   ```
5. Click **"Save Changes"**

#### Step 4: Set Up Instagram Business Account

**Required**: Instagram Graph API only works with Instagram Business or Creator accounts linked to a Facebook Page.

1. **Convert your Instagram account** (if not already done):
   - Go to Instagram app → Settings → Account → Switch to Professional Account
   - Choose **"Business"** or **"Creator"**
   
2. **Create or connect a Facebook Page**:
   - Go to [Facebook Pages](https://www.facebook.com/pages/create)
   - Create a business page or use an existing one
   - Link your Instagram account to this page:
     - Go to Page Settings → Instagram → Connect Account

3. **Add Instagram account to your Meta App**:
   - In your Meta App, go to **Instagram Graph API** → **Getting Started**
   - Click **"Add Instagram Account"**
   - Select your connected Instagram Business account

#### Step 5: Get Your App Credentials

1. Go to **Settings** → **Basic** in your Meta App dashboard
2. Copy your **App ID** and **App Secret**
3. Add them to your `.env` file:
   ```bash
   FACEBOOK_APP_ID="your-meta-app-id-here"
   FACEBOOK_APP_SECRET="your-meta-app-secret-here"
   ```

#### Step 6: Request Permissions

For Instagram Graph API, you need to request specific permissions:

1. In your Meta App, go to **App Review** → **Permissions and Features**
2. Request the following permissions:
   - `instagram_graph_user_profile` - Access to basic profile info
   - `instagram_graph_user_media` - Access to media
   - `pages_show_list` - Access to Facebook Pages
   - `pages_read_engagement` - Read page engagement data

**Note**: Some permissions require app review for production use.

#### Step 7: Test the Integration

1. Restart your development server after updating the `.env` file
2. Go to the Brands page in your application
3. Click **"Connect Instagram Account"** on any brand
4. You should be redirected to Facebook for authorization
5. Grant permissions for your Instagram Business account

#### Production Setup

For production deployment:

1. **Update Redirect URIs** in your Meta App:
   ```
   https://yourdomain.com/auth/instagram/callback
   ```

2. **Submit for App Review**:
   - Instagram Graph API requires app review for most permissions
   - Submit your app with detailed use case descriptions
   - Provide privacy policy and terms of service URLs

3. **Environment Variables**: Update production `.env` with production credentials

#### Troubleshooting

**"Invalid App ID" Error**:
- Verify your `FACEBOOK_APP_ID` is correct (numbers only, no quotes in the actual value)
- Ensure you've restarted the server after updating `.env`
- Check that your Meta App has Instagram Graph API and Facebook Login products added

**OAuth Redirect Errors**:
- Verify the redirect URI in Facebook Login settings matches exactly: `http://localhost:3000/auth/instagram/callback`
- Ensure there are no trailing slashes or extra characters

**"This app cannot be installed" Error**:
- Your Instagram account must be converted to Business/Creator
- The account must be linked to a Facebook Page
- The Instagram account must be added to your Meta App

**Permission Denied Errors**:
- Ensure you've requested the required permissions in App Review
- Check that your Instagram Business account is properly connected to a Facebook Page
- Verify the Facebook Page is added to your Meta App

**"User does not have permission" Error**:
- The user must be an admin of the Facebook Page connected to the Instagram account
- Add test users in your Meta App for development testing

## Development

### Backend Development

```bash
# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

### Frontend Development

```bash
cd frontend

# Development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Linting
npm run lint
```

### Database Management

```bash
# Create new migration
npx prisma migrate dev --name migration-name

# Reset database (development only)
npx prisma migrate reset

# Generate Prisma client
npx prisma generate

# Deploy migrations (production)
npx prisma migrate deploy
```

## API Documentation

### Authentication Endpoints

- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `GET /auth/me` - Get current user profile

### Brand Management

- `GET /brands/list` - List user's brands
- `POST /brands/create` - Create new brand
- `POST /brands/analyze` - Analyze brand style from Instagram posts

### Content Management

- `POST /content/generate` - Generate new content
- `GET /content/pending/:brandId` - Get pending content for approval
- `POST /content/approve` - Approve content (with optional scheduling)
- `POST /content/reject/:contentId` - Reject content
- `GET /content/history/:brandId` - Get content history

### Instagram Integration

#### OAuth Authentication
- `GET /auth/instagram/authorize?brandId={id}` - Initiate Instagram OAuth flow
- `POST /auth/instagram/callback` - Handle OAuth callback

#### Account Management
- `GET /instagram/status/:brandId` - Check Instagram connection status
- `POST /instagram/disconnect` - Disconnect Instagram from brand
- `POST /instagram/refresh-token` - Refresh Instagram access token

#### Content & Publishing
- `GET /instagram/profile` - Get Instagram profile information
- `GET /instagram/posts` - Get Instagram posts with pagination
- `POST /instagram/publish` - Publish content to Instagram
- `GET /instagram/insights/:postId` - Get post insights and metrics

#### Webhooks
- `GET /instagram/webhooks` - Webhook verification endpoint
- `POST /instagram/webhooks` - Webhook event handler

### Analytics & Scheduling

- `GET /analytics/report/:brandId` - Get comprehensive analytics report
- `GET /analytics/optimal-times/:brandId` - Get optimal posting times
- `GET /analytics/schedule-recommendation/:brandId` - Get scheduling recommendation
- `POST /analytics/schedule` - Schedule content for posting
- `GET /analytics/scheduled/:brandId` - Get scheduled posts
- `DELETE /analytics/scheduled/:contentId` - Cancel scheduled post
- `PUT /analytics/reschedule` - Reschedule post to new time
- `POST /analytics/bulk-schedule` - Bulk schedule multiple posts
- `GET /analytics/stats/:brandId` - Get scheduling statistics
- `POST /analytics/collect-metrics/:contentId` - Collect post metrics

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- test/auth.test.ts

# Run tests with coverage
npm run test:coverage
```

## Production Deployment

### Environment Variables

Set the following environment variables in production:

```bash
DATABASE_URL=postgresql://username:password@host:port/database
JWT_SECRET=your-secure-jwt-secret
OPENAI_API_KEY=your-openai-api-key
NODE_ENV=production
PORT=3000
```

### Build and Deploy

```bash
# Build backend
npm run build

# Build frontend
cd frontend
npm run build

# Start production server
npm start
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose -f docker-compose.prod.yml up -d
```

## Project Structure

```
ai-agency/
├── src/                    # Backend source code
│   ├── routes/            # API route handlers
│   │   ├── auth.ts        # User authentication endpoints
│   │   ├── instagram-oauth.ts # Instagram OAuth flow
│   │   ├── brands.ts      # Brand management
│   │   ├── content.ts     # Content generation & approval
│   │   ├── instagram.ts   # Instagram API integration
│   │   └── analytics.ts   # Analytics & scheduling
│   ├── services/          # Business logic services
│   │   ├── ai.ts          # OpenAI content generation
│   │   ├── jwt.ts         # JWT authentication
│   │   ├── instagram.ts   # Instagram Graph API
│   │   ├── redis.ts       # Redis caching & rate limiting
│   │   ├── analytics.ts   # Analytics & metrics collection
│   │   └── scheduler.ts   # Automated posting scheduler
│   ├── plugins/           # Fastify plugins
│   └── server.ts          # Main server file
├── frontend/              # Frontend React application
│   ├── src/
│   │   ├── components/    # Reusable React components
│   │   │   ├── ContentCard.tsx       # Content preview component
│   │   │   ├── InstagramConnect.tsx  # Instagram OAuth & connection management
│   │   │   ├── Layout.tsx            # App layout wrapper
│   │   │   ├── AnalyticsChart.tsx    # Charts for analytics
│   │   │   └── SchedulingPanel.tsx   # Scheduling management
│   │   ├── pages/         # Page components
│   │   │   ├── Dashboard.tsx        # Main dashboard
│   │   │   ├── Login.tsx           # User authentication
│   │   │   ├── Brands.tsx          # Brand management
│   │   │   ├── Content.tsx         # Content approval
│   │   │   └── Analytics.tsx       # Analytics & scheduling
│   │   ├── stores/        # Zustand state management
│   │   └── lib/           # Utilities and API client
├── test/                  # Backend test files
│   ├── auth.test.ts       # Authentication tests
│   ├── brands.test.ts     # Brand management tests
│   ├── content.test.ts    # Content generation tests
│   ├── instagram.test.ts  # Instagram integration tests
│   └── analytics.test.ts  # Analytics & scheduling tests
├── prisma/                # Database schema and migrations
└── docker-compose.yml     # Docker services configuration
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License.