# How to Access Individual Post Detail Page

## 🚀 Quick Steps

1. **Start the application**:
   ```bash
   npm run start:all
   ```

2. **Open your browser**:
   - Navigate to: http://localhost:5173

3. **Login**:
   - Email: `demo@example.com`
   - Password: `password123`

4. **Navigate to Content Calendar**:
   - Click on **"Content"** in the left sidebar menu
   - Or navigate directly to: http://localhost:5173/content

5. **Click on any post to view details**:

## 📍 Three Ways to Access Individual Posts

### Method 1: List View (Easiest)
1. In the Content Calendar, click the **List View** button (rightmost view option)
2. You'll see all posts in a list format
3. **Click on any post row** - the entire row is clickable
4. You'll be taken to `/content/{contentId}` showing the post details

### Method 2: Calendar View
1. In the Content Calendar, stay in the default **Month View**
2. Look for colored blocks on calendar days (these are posts)
3. **Click on any colored post block**
4. You'll navigate to the individual post page

### Method 3: Timeline View
1. In the Content Calendar, click the **Timeline View** button (middle view option)
2. You'll see posts arranged in a weekly timeline
3. **Click on any post card**
4. You'll be taken to the post detail page

### Method 4: Direct URL
If you know a content ID, you can navigate directly:
```
http://localhost:5173/content/{contentId}
```

For example, with the test data:
- http://localhost:5173/content/cmed74p5k00031x3pyjsajss9 (Published post with analytics)
- http://localhost:5173/content/cmed74p5r00051x3pp065yxhb (Scheduled post)
- http://localhost:5173/content/cmed74p5z00091x3pmql5udfa (Draft post)

## 🎯 What You'll See on the Post Detail Page

### Main Content Area (Left side):
- **Post Image** (if available)
- **Caption** - Full post text
- **Hashtags** - All hashtags as badges
- **Analytics** (for published posts) - Likes, Comments, Reach

### Sidebar (Right side):
- **Status Badge** - Draft, Scheduled, Published, Failed
- **Campaign Name** (if part of a campaign)
- **Created Date**
- **Scheduled Date/Time** (for scheduled posts)
- **Published Date/Time** (for published posts)

### Action Buttons (based on status):
- **Draft Posts**:
  - Approve & Schedule
  - Edit Post
  - Reject
  
- **Scheduled Posts**:
  - Publish Now
  - Reschedule
  - Edit Post
  - Cancel Post

- **Published Posts**:
  - View on Instagram (if linked)
  - Analytics details

## 🔍 Visual Guide

```
App Layout:
┌─────────────────────────────────────────┐
│  Logo     Dashboard  Brands  [Content]  │  <- Click "Content"
├─────────────────────────────────────────┤
│                                         │
│  Content Calendar                       │
│  ┌───────────────────────────────┐     │
│  │ [Month] [Timeline] [List] ←─────────│── Choose any view
│  └───────────────────────────────┘     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  Post 1  │  Post 2  │  Post 3   │   │  <- Click any post
│  │ [Click]  │ [Click]  │ [Click]   │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
                    ↓
         Navigates to /content/{id}
                    ↓
┌─────────────────────────────────────────┐
│         Individual Post Detail          │
│  ┌─────────────┬──────────────┐        │
│  │   Image     │   Status      │        │
│  │   Caption   │   Metadata    │        │
│  │   Hashtags  │   Actions     │        │
│  └─────────────┴──────────────┘        │
└─────────────────────────────────────────┘
```

## 🐛 Troubleshooting

### If clicking doesn't work:
1. **Check the console** (F12) for any JavaScript errors
2. **Ensure you're logged in** - you should see brands in the top bar
3. **Make sure you have content** - run `node scripts/check-content.mjs` to verify

### If you see "Post Not Found":
1. The post might have been deleted
2. You might not have permission (wrong user)
3. The content ID in the URL might be invalid

### If the page is blank:
1. Check if the backend is running: `http://localhost:3000/api/health`
2. Check if frontend compiled: Look for errors in terminal
3. Try refreshing the page (Ctrl+F5)

## 📝 Test Different Post Types

With the generated test data, try viewing:

1. **Published Post** - Has analytics data (likes, comments, reach)
2. **Scheduled Post** - Shows future publish date/time
3. **Draft Post** - Shows approval actions
4. **Failed Post** - Shows error message

Each type has different actions and displays different information!

## 💡 Pro Tips

- Use **List View** for the easiest navigation - entire rows are clickable
- The URL pattern is `/content/{contentId}` - you can bookmark specific posts
- Use browser back button to return to the calendar
- Posts from campaigns show the campaign name in the sidebar