# Test Data Summary

## 🔐 Login Credentials
- **Email**: demo@example.com
- **Password**: password123

## 📊 Generated Data Overview

### 👤 User Account
- **Name**: Demo User
- **Subscription**: Premium tier
- **Created**: Successfully with all features enabled

### 🏢 Brands (11 total)
1. **CyberTech Innovations** - AI and robotics company
2. **RoboForge Labs** - Advanced robotics manufacturer
3. **NeuroLink Digital** - Brain-computer interface startup
4. **Quantum Rebellion** - Cyberpunk fashion brand
5. **Synthetic Minds Studio** - AI art collective
6. **Sunrise Coffee Co.** - Artisanal coffee roasters
7. **TechFlow Solutions** - Tech solutions provider
8. **Green Leaf Wellness** - Wellness and health brand
9. **Urban Threads** - Fashion brand
10. **Peak Performance Fitness** - Fitness and training
11. **Artisan Bakery** - Bakery and pastries

### 📅 Campaigns (2 total)
1. **Holiday Season Campaign** (Active)
   - Status: Active
   - Progress: 60%
   - Content: 6 posts
   - Themes: holiday, celebration, innovation, tech
   - Frequency: Daily posting

2. **Q1 Product Launch** (Draft)
   - Status: Creating
   - Progress: 0%
   - Content: 0 posts (not yet generated)
   - Themes: product, launch, innovation, features
   - Frequency: Every other day

### 📝 Content (15 posts)
- **Published**: 1 post (with analytics data)
- **Scheduled**: 6 posts
- **Draft**: 7 posts
- **Failed**: 1 post (demonstrating error handling)

#### Content Distribution:
- CyberTech Innovations: 9 posts
- RoboForge Labs: 1 post
- Sunrise Coffee Co.: 3 posts
- Green Leaf Wellness: 1 post
- Peak Performance Fitness: 1 post

### 🎯 Test Scenarios Available

1. **View Individual Post Details**
   - Navigate to Content Calendar
   - Click on any post to view details
   - Published post includes analytics (likes, comments, reach)

2. **Campaign Management**
   - View active campaign with progress
   - See draft campaign ready for configuration
   - Test pause/resume functionality

3. **Content States**
   - Draft posts ready for approval
   - Scheduled posts for future publishing
   - Published post with performance metrics
   - Failed post showing error handling

4. **Brand Variety**
   - Multiple brands with different themes
   - Some with style analysis completed
   - Various industry types represented

## 🚀 Quick Start Testing

1. Start the application:
   ```bash
   npm run start:all
   ```

2. Navigate to http://localhost:5173

3. Login with:
   - Email: demo@example.com
   - Password: password123

4. Test the individual post page:
   - Go to Content Calendar
   - Click on any post in List view
   - Or click on a post in Calendar/Timeline view
   - View post details, status, and actions

## 📋 Available Scripts

- `node scripts/create-demo-user.mjs` - Create demo user with brands
- `node scripts/generate-test-data.mjs` - Generate additional test data
- `node scripts/add-demo-content.mjs` - Add sample content
- `node scripts/create-test-campaign.mjs` - Create campaigns with content
- `node scripts/list-campaigns.mjs` - List all campaigns
- `node scripts/check-content.mjs` - Check all content items
- `node scripts/check-users.mjs` - List all users and their brands

## 🔄 Reset Data

To start fresh:
```bash
# Clear all data
npx prisma migrate reset

# Regenerate test data
node scripts/create-demo-user.mjs
node scripts/generate-test-data.mjs
node scripts/add-demo-content.mjs
node scripts/create-test-campaign.mjs
```

## ✨ Features to Test

- [x] User authentication
- [x] Brand management
- [x] Content creation and scheduling
- [x] Campaign management
- [x] Individual post viewing
- [x] Content calendar views (Month, Timeline, List)
- [x] Post status tracking
- [x] Analytics visualization (for published posts)
- [x] Error state handling
- [x] Navigation between views