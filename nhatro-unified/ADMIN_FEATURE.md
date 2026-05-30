# Admin User Management Feature

## Overview

This feature allows admin users to manage other users in the system. Admins can:

- View all registered users
- Change user roles (admin ↔ user)
- Set room limits for each user (limit how many rooms a user can manage)
- View how many rooms each user currently has

## Features

### 1. User Roles

- **Admin**: Can manage other users, set room limits, and access the admin panel
- **User**: Regular user with standard access to manage their own rooms

### 2. Room Limits

Each user can have a maximum room limit:
- **Unlimited**: `null` or empty (default)
- **Limited**: Set to a specific number (e.g., 5 means user can have max 5 rooms)

### 3. Admin Dashboard

Access the admin panel in Settings:
- Go to **Settings** page (gear icon in sidebar)
- Click the **"Quản lý người dùng"** tab (only visible to admins)
- View, edit, and manage all users

## Setup

### Initial Admin Promotion

Since the system starts with no admin users, you need to promote the first user to admin using the CLI:

```bash
cd server
node promote-to-admin.js promote <email_or_phone>
```

#### Example:

```bash
# Promote user by email
node promote-to-admin.js promote admin@example.com

# Promote user by phone
node promote-to-admin.js promote 0912345678

# List all users
node promote-to-admin.js list

# Set room limit
node promote-to-admin.js limit admin@example.com 10

# Remove admin status
node promote-to-admin.js demote admin@example.com
```

## API Endpoints

### Authentication

All endpoints require valid JWT token in Authorization header:
```
Authorization: Bearer <token>
```

### Get All Users (Admin only)

```
GET /api/admin/users
```

**Response:**
```json
{
  "users": [
    {
      "id": "uuid",
      "name": "User Name",
      "email": "user@example.com",
      "phone": "0912345678",
      "role": "admin",
      "maxRoomLimit": null,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Update User (Admin only)

```
PUT /api/admin/users/:userId
Content-Type: application/json

{
  "role": "admin|user",
  "maxRoomLimit": null | number
}
```

### Get User's Room Count (Admin only)

```
GET /api/admin/users/:userId/rooms
```

**Response:**
```json
{
  "roomCount": 5
}
```

## User Experience

### For Admin Users

1. After logging in, navigate to Settings
2. Click the "Quản lý người dùng" tab
3. View list of all users with:
   - User name, email, phone
   - Number of rooms they currently manage
   - Current role (Admin/User)
   - Current room limit
4. Click "Sửa" to edit a user:
   - Change role
   - Set/modify room limit
5. Click "Lưu" to save changes

### For Regular Users

- Normal Settings page without the user management tab
- Can manage their own rooms and data
- Cannot access admin panel

## Data Storage

### User Structure

Users are stored with these fields:

```javascript
{
  id: "uuid",                    // Unique identifier
  name: "User Name",             // User's name
  email: "user@example.com",     // Email (optional, if phone is provided)
  phone: "0912345678",           // Phone (optional, if email is provided)
  password_hash: "...",          // Hashed password (pbkdf2)
  password_salt: "...",          // Password salt
  createdAt: "2024-01-01T...",  // Account creation timestamp
  role: "user|admin",            // User role (default: "user")
  maxRoomLimit: null | number    // Maximum rooms (null = unlimited)
}
```

### Where Data is Stored

- **Local (default)**: `server/data/users.json`
- **NocoDB** (if configured): Table specified in `NOCODB_TABLE_USERS` env var

Each user's room data is stored in:
- `server/data/states/{userId}.json`

## Security

### Admin Restrictions

- Only admins can access `/api/admin/*` endpoints
- Admins cannot remove their own admin status (prevented on backend)
- Admin role can only be set via CLI or API, not through UI registration

### Permissions

- Each user's data is isolated to their own state file
- Users cannot access other users' data
- Only admins can view the user list

## Development

### Backend Changes

Files modified:
- `server/index.js` - Added admin middleware and endpoints

New endpoints:
- `GET /api/admin/users` - List all users
- `PUT /api/admin/users/:userId` - Update user
- `GET /api/admin/users/:userId/rooms` - Get user's room count

Auth endpoints updated to return role:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Frontend Changes

Files created:
- `web/src/components/UserManagement.jsx` - User management component

Files modified:
- `web/src/pages/Settings.jsx` - Added tabs and admin section
- `web/src/App.jsx` - Pass user object to Settings

### Database Schema Update (for NocoDB users)

Add these fields to the `users` table:

```sql
ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'user';
ALTER TABLE users ADD COLUMN maxRoomLimit INT;
```

## Troubleshooting

### Admin Tab Not Showing

1. Check if user has `role: 'admin'` in database
2. Try logging out and back in to refresh token
3. Check browser console for API errors

### Cannot Set Room Limit

1. Verify admin user is making the request
2. Check room limit is a valid number (0-9999)
3. Use 0 or empty field for unlimited

### Initial Setup Issues

1. Ensure at least one user is registered
2. Run `node promote-to-admin.js list` to verify users exist
3. Run `node promote-to-admin.js promote <email>` to set admin

## Future Enhancements

- [ ] Batch user management (select multiple users)
- [ ] User activity logs (track who manages what)
- [ ] User groups for permission sets
- [ ] API key management for each user
- [ ] Two-factor authentication
- [ ] Audit trail for admin actions
