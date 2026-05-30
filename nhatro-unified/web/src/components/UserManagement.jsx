import React, { useState, useEffect } from 'react';
import { getStoredToken } from '../utils/auth';

export default function UserManagement({ isAdmin = false }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingForm, setEditingForm] = useState({});
  const [roomCounts, setRoomCounts] = useState({});

  const token = getStoredToken();

  useEffect(() => {
    if (!isAdmin) {
      setError('Bạn không có quyền truy cập quản lý người dùng');
      setLoading(false);
      return;
    }
    loadUsers();
  }, [isAdmin]);

  async function loadUsers() {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Không thể tải danh sách người dùng');
      }

      const data = await response.json();
      setUsers(data.users || []);

      const counts = {};
      for (const user of data.users || []) {
        counts[user.id] = user.roomCount ?? 0;
      }
      setRoomCounts(counts);
    } catch (err) {
      setError(err.message || 'Lỗi tải danh sách người dùng');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveUser(userId) {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          role: editingForm.role,
          maxRoomLimit: editingForm.maxRoomLimit === '' ? null : Number(editingForm.maxRoomLimit) || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Không thể cập nhật người dùng');
      }

      setEditingUserId(null);
      await loadUsers();
      alert('Cập nhật người dùng thành công');
    } catch (err) {
      alert('Lỗi: ' + (err.message || 'Không thể cập nhật'));
    }
  }

  function handleEditUser(user) {
    setEditingUserId(user.id);
    setEditingForm({
      role: user.role,
      maxRoomLimit: user.maxRoomLimit === null ? '' : String(user.maxRoomLimit),
    });
  }

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <div className="text-sm text-rose-700">
          ⚠️ Bạn không có quyền quản lý người dùng. Liên hệ với admin để được cấp quyền.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-center text-slate-400">
        Đang tải danh sách người dùng...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <div className="text-sm text-rose-700">{error}</div>
        <button onClick={loadUsers} className="mt-3 rounded-lg bg-rose-600 text-white px-3 py-2 text-sm">
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold mb-4">Quản lý người dùng</h3>

      {users.length === 0 ? (
        <div className="text-center py-8 text-slate-500">Chưa có người dùng nào.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600">
                <th className="p-3 text-left">Tên</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-left">Số ĐT</th>
                <th className="p-3 text-center">Phòng</th>
                <th className="p-3 text-center">Vai trò</th>
                <th className="p-3 text-center">Giới hạn phòng</th>
                <th className="p-3 text-center">Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-100">
                  {editingUserId === user.id ? (
                    <>
                      <td className="p-3">{user.name || '—'}</td>
                      <td className="p-3">{user.email || user.phone || '—'}</td>
                      <td className="p-3">{user.phone || '—'}</td>
                      <td className="p-3 text-center">{roomCounts[user.id] ?? user.roomCount ?? 0}</td>
                      <td className="p-3">
                        <select
                          className="rounded-lg border px-2 py-1 w-full text-sm"
                          value={editingForm.role}
                          onChange={(e) =>
                            setEditingForm({ ...editingForm, role: e.target.value })
                          }
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          className="rounded-lg border px-2 py-1 w-full text-sm"
                          placeholder="Không giới hạn"
                          value={editingForm.maxRoomLimit}
                          onChange={(e) =>
                            setEditingForm({ ...editingForm, maxRoomLimit: e.target.value })
                          }
                        />
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleSaveUser(user.id)}
                          className="rounded bg-emerald-600 text-white px-2 py-1 text-xs sm:text-sm mr-1"
                        >
                          Lưu
                        </button>
                        <button
                          onClick={() => setEditingUserId(null)}
                          className="rounded border px-2 py-1 text-xs sm:text-sm"
                        >
                          Hủy
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3">{user.name || '—'}</td>
                      <td className="p-3">{user.email || user.phone || '—'}</td>
                      <td className="p-3">{user.phone || '—'}</td>
                      <td className="p-3 text-center font-medium">{roomCounts[user.id] ?? user.roomCount ?? 0}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${
                            user.role === 'admin'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {user.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {user.maxRoomLimit === null || user.maxRoomLimit === undefined ? (
                          <span className="text-slate-500">Không giới hạn</span>
                        ) : (
                          <span className="font-medium">{user.maxRoomLimit}</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleEditUser(user)}
                          className="rounded border px-2 py-1 text-xs sm:text-sm hover:bg-slate-50"
                        >
                          Sửa
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-500 space-y-1">
        <p>
          <strong>Vai trò:</strong> Admin có thể quản lý người dùng khác; User là người dùng bình thường.
        </p>
        <p>
          <strong>Giới hạn phòng:</strong> Để trống hoặc 0 = không giới hạn. Số dương = tối đa bao nhiêu phòng.
        </p>
      </div>
    </div>
  );
}
