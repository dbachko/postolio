# Instagram AI Agency

A full-stack application for automated Instagram content generation and management using AI. The platform analyzes brand styles, generates personalized content, and provides an approval workflow for social media managers.

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
- ✅ Instagram API integration with automated posting
- ✅ Analytics and optimal posting times with performance tracking
- ✅ Responsive web dashboard with analytics interface
- 🚧 Engagement automation (upcoming)

## Quick Start

### Prerequisites

- Node.js 20+ 
- Docker and Docker Compose
- OpenAI API key

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

Create `.env` file in the project root:

```bash
# Database
DATABASE_URL="postgresql://aiagency:aiagency123@localhost:5432/aiagency"

# JWT Secret (generate a secure random string)
JWT_SECRET="your-jwt-secret-here"

# OpenAI API
OPENAI_API_KEY="your-openai-api-key-here"

# Instagram API (optional for testing)
INSTAGRAM_ACCESS_TOKEN="your-instagram-access-token"
INSTAGRAM_PAGE_ID="your-instagram-page-id"

# Server
PORT=3000
NODE_ENV=development
```

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

- `GET /instagram/profile` - Get Instagram profile information
- `GET /instagram/posts` - Get Instagram posts
- `POST /instagram/connect` - Connect Instagram account to brand
- `POST /instagram/publish` - Publish content to Instagram
- `GET /instagram/insights/:postId` - Get post insights and metrics
- `POST /instagram/disconnect` - Disconnect Instagram from brand
- `GET /instagram/status/:brandId` - Check Instagram connection status

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
│   │   ├── auth.ts        # Authentication endpoints
│   │   ├── brands.ts      # Brand management
│   │   ├── content.ts     # Content generation & approval
│   │   ├── instagram.ts   # Instagram API integration
│   │   └── analytics.ts   # Analytics & scheduling
│   ├── services/          # Business logic services
│   │   ├── ai.ts          # OpenAI content generation
│   │   ├── jwt.ts         # JWT authentication
│   │   ├── instagram.ts   # Instagram Graph API
│   │   ├── analytics.ts   # Analytics & metrics collection
│   │   └── scheduler.ts   # Automated posting scheduler
│   ├── plugins/           # Fastify plugins
│   └── server.ts          # Main server file
├── frontend/              # Frontend React application
│   ├── src/
│   │   ├── components/    # Reusable React components
│   │   │   ├── ContentCard.tsx      # Content preview component
│   │   │   ├── Layout.tsx           # App layout wrapper
│   │   │   ├── AnalyticsChart.tsx   # Charts for analytics
│   │   │   └── SchedulingPanel.tsx  # Scheduling management
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