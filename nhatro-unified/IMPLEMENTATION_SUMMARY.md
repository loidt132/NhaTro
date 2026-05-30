# Admin User Management Feature - Implementation Summary

## Changes Made

### Backend Changes (server/index.js)

1. **Updated User Registration**
   - Added `role: 'user'` field (default for new users)
   - Added `maxRoomLimit: null` field (unlimited by default)

2. **Updated Authentication Responses**
   - `POST /api/auth/register` now returns role and maxRoomLimit
   - `POST /api/auth/login` now returns role and maxRoomLimit
   - `GET /api/auth/me` now returns role and maxRoomLimit

3. **Added Admin Middleware**
   - New `adminMiddleware` function to check if user has admin role
   - Protects all admin endpoints

4. **New Admin Endpoints**
   - `GET /api/admin/users` - List all users with their details
   - `PUT /api/admin/users/:userId` - Update user role and maxRoomLimit
   - `GET /api/admin/users/:userId/rooms` - Get count of rooms a user manages

### Frontend Changes

#### New Files
- `web/src/components/UserManagement.jsx` - Admin user management component
  - Displays table of all users
  - Shows room count for each user
  - Allows editing role and room limits
  - Handles API calls for user management

#### Modified Files
- `web/src/pages/Settings.jsx`
  - Added tab system (General Settings | User Management)
  - User Management tab only visible to admins
  - Integrated UserManagement component
  - Fetches user data to determine admin status

- `web/src/App.jsx`
  - Pass user object to Settings component

### CLI Tools

#### New File
- `server/promote-to-admin.js` - Command-line tool for admin management
  - Commands:
    - `promote <email_or_phone>` - Promote user to admin
    - `demote <email_or_phone>` - Remove admin status
    - `list` - Show all users
    - `limit <email_or_phone> <count>` - Set room limit

### Database Schema

#### Modified File
- `server/nocodb-schema.sql`
  - Added `role VARCHAR(32) DEFAULT 'user'` column to users table
  - Added `maxRoomLimit INT` column to users table

## Features

### Admin Capabilities

Admins can:
1. View all registered users in the system
2. See how many rooms each user is currently managing
3. Change any user's role (between "admin" and "user")
4. Set room limits for each user:
   - `null` or 0 = unlimited rooms
   - Positive number = maximum rooms allowed
5. Prevent self-demotion (can't remove own admin role)

### User Experience

**For Admin Users:**
- Settings page has two tabs
- "Cài đặt chung" - General settings (same as before)
- "Quản lý người dùng" - User management dashboard
- Edit button on each user to modify role and limits

**For Regular Users:**
- Settings page only shows general settings
- No access to user management

## Security Features

1. **Role-Based Access Control (RBAC)**
   - All admin endpoints check for admin role
   - Regular users cannot access admin APIs

2. **Data Isolation**
   - Each user's rooms are stored in separate state file
   - Users cannot access other users' data

3. **Admin Protection**
   - Cannot remove own admin status via API
   - Admin role only set via CLI or direct API by other admins

4. **Authentication**
   - All endpoints require valid JWT token
   - Token must be in Authorization header

## Initial Setup Instructions

1. **Start the server normally** - First admin account can be created via CLI

2. **Register a user account** through the web interface

3. **Promote user to admin** using CLI:
   ```bash
   cd server
   node promote-to-admin.js promote user@example.com
   ```

4. **Log in** with the admin account

5. **Access Settings > "Quản lý người dùng"** to manage other users

## API Examples

### Get All Users
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:4000/api/admin/users
```

### Update User Role and Room Limit
```bash
curl -X PUT \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin", "maxRoomLimit": 5}' \
  http://localhost:4000/api/admin/users/<userId>
```

### Get User's Room Count
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:4000/api/admin/users/<userId>/rooms
```

## Validation & Error Handling

### Backend Validation
- Role must be "admin" or "user"
- maxRoomLimit must be positive integer or null
- Cannot demote self from admin
- User not found returns 404
- Insufficient permissions returns 403

### Frontend Validation
- Shows loading state while fetching users
- Displays error messages clearly
- Prevents API calls if not admin
- Validates numeric inputs for room limits

## Future Enhancements

- Room limit enforcement (prevent creating rooms beyond limit)
- User activity logging
- Batch user management
- User export/import
- More granular permissions
- User status (active/inactive)
- Last login tracking

## Testing

To test the feature:

1. **Create test users**
   ```bash
   # User 1 - will be admin
   # User 2 - regular user
   # User 3 - regular user
   ```

2. **Promote User 1 to admin**
   ```bash
   node promote-to-admin.js promote <user1_email>
   ```

3. **Log in as admin**
   - Navigate to Settings
   - Should see "Quản lý người dùng" tab

4. **Test user management**
   - View all users
   - Edit User 2 role
   - Set room limit for User 3
   - Verify changes persist after refresh

5. **Log in as regular user**
   - Should NOT see "Quản lý người dùng" tab

## Files Modified/Created

### Created:
- `web/src/components/UserManagement.jsx`
- `server/promote-to-admin.js`
- `ADMIN_FEATURE.md`
- `IMPLEMENTATION_SUMMARY.md` (this file)

### Modified:
- `server/index.js` - Added role/maxRoomLimit fields and admin endpoints
- `server/nocodb-schema.sql` - Added columns to users table
- `web/src/pages/Settings.jsx` - Added admin tab and component integration
- `web/src/App.jsx` - Pass user to Settings

## Dependencies

No new external dependencies required. Uses:
- Existing Express.js API setup
- Existing React/Vite frontend
- Existing authentication system

## Deployment Notes

1. **Database Migration**: If using NocoDB, run the SQL schema update
2. **No environment variables needed**: Feature works with existing setup
3. **Backward Compatible**: Existing users without role field default to "user"
4. **State file compatible**: Rooms/tenants data format unchanged
