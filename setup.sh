#!/bin/bash

#!/bin/bash
# Postolio - Quick Setup Script

echo "🚀 Setting up Postolio..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend && npm install && cd ..

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your OpenAI API key and other configurations"
else
    echo "✅ .env file already exists"
fi

# Start PostgreSQL database
echo "🐘 Starting PostgreSQL database..."
docker-compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
sleep 5

# Run database migrations
echo "🗄️  Running database migrations..."
npx prisma migrate dev --name init

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the application:"
echo "  npm run start:all"
echo ""
echo "Or start services individually:"
echo "  npm run dev:db      # Start database"
echo "  npm run dev         # Start backend (port 3000)"
echo "  npm run dev:frontend # Start frontend (port 5173)"
echo ""
echo "⚠️  Don't forget to:"
echo "  1. Edit .env file with your OpenAI API key"
echo "  2. Generate a secure JWT_SECRET"
echo ""
echo "📚 Access the application:"
echo "  Frontend: http://localhost:5173"
echo "  Backend API: http://localhost:3000"
echo "  API Health: http://localhost:3000/health"
