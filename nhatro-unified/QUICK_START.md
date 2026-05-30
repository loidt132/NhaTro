# Quick Start: Admin User Management

## What Was Added

✅ **Admin Role System** - Users can be "admin" or "user"  
✅ **Room Limits** - Set how many rooms each user can manage  
✅ **Admin Panel** - UI to manage all users  
✅ **CLI Tool** - Command-line tool to promote admins  
✅ **API Endpoints** - Backend APIs for user management  

---

## Getting Started

### Step 1: Start Server Normally
```bash
cd server
npm install
npm start
```

### Step 2: Register First User
- Go to web app at http://localhost:5173
- Register a user account (email or phone)

### Step 3: Promote to Admin (via CLI)
```bash
cd server
node promote-to-admin.js promote your@email.com
```

### Step 4: Log In & Visit Settings
- Log in with that account
- Go to Settings → "Quản lý người dùng" tab
- You'll see all users and can manage them

---

## Admin Commands

```bash
# List all users
node promote-to-admin.js list

# Promote user to admin
node promote-to-admin.js promote user@example.com

# Demote admin to regular user  
node promote-to-admin.js demote user@example.com

# Set room limit (e.g., max 5 rooms)
node promote-to-admin.js limit user@example.com 5

# Unlimited rooms
node promote-to-admin.js limit user@example.com 0
```

---

## Admin Features (Web UI)

### In Settings > "Quản lý người dùng" Tab

| Feature | Description |
|---------|-------------|
| **Tên** | User name |
| **Email** | User's email |
| **Số ĐT** | User's phone |
| **Phòng** | How many rooms they currently manage |
| **Vai trò** | Admin or User |
| **Giới hạn phòng** | Max rooms they can have (empty = unlimited) |
| **Sửa** | Edit user's role and limits |

### Edit User Dialog

Change:
- **Vai trò**: Switch between "User" and "Admin"
- **Giới hạn phòng**: Set max rooms (leave empty for unlimited)

---

## API Endpoints

All require `Authorization: Bearer <token>` header

```
GET  /api/admin/users                    → List all users
PUT  /api/admin/users/:userId            → Update user role & limit
GET  /api/admin/users/:userId/rooms      → Get user's room count
```

---

## Features Explained

### Role: Admin vs User
- **Admin**: Can see and manage all users, set room limits
- **User**: Regular account, manages only their own rooms

### Room Limits
- **Empty/0**: User can have unlimited rooms
- **5**: User can have maximum 5 rooms
- **10**: User can have maximum 10 rooms

---

## Security

✅ Only admins can access the user management panel  
✅ Admins can't remove their own admin status  
✅ Each user's data is separate and private  
✅ All requests require valid JWT token  

---

## If You Need Help

### Issue: Admin tab not showing
- Make sure you promoted the user to admin
- Log out and back in to refresh

### Issue: Can't set room limit  
- Make sure you're an admin
- Try using the CLI tool instead

### Issue: Can't find a user
- Use `node promote-to-admin.js list` to see all users
- Check spelling of email/phone

---

## File Locations

| File | Purpose |
|------|---------|
| `server/index.js` | Backend API changes |
| `web/src/components/UserManagement.jsx` | Admin UI component |
| `web/src/pages/Settings.jsx` | Settings page with tabs |
| `server/promote-to-admin.js` | CLI tool for admins |
| `ADMIN_FEATURE.md` | Full documentation |

---

## Next Steps

1. ✅ First user is promoted to admin
2. ✅ Access Settings > "Quản lý người dùng"
3. ✅ Register more users and manage them
4. ✅ Set room limits as needed

Enjoy! 🎉
