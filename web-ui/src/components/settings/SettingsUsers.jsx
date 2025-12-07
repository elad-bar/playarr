import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  IconButton,
  Typography,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import LockResetIcon from '@mui/icons-material/LockReset';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { usersService } from '../../services/users';
import UserForm from './users/UserForm';
import { useAuth } from '../../context/AuthContext';
import { getUserRoleColor } from './users/utils';

const SettingsUsers = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Dialog states
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await usersService.getAllUsers();
      // Ensure data is an array and sort alphabetically by username
      const userArray = Array.isArray(data) ? data : [];
      const sortedUsers = [...userArray].sort((a, b) => {
        const usernameA = (a.username || '').toLowerCase();
        const usernameB = (b.username || '').toLowerCase();
        return usernameA.localeCompare(usernameB);
      });
      setUsers(sortedUsers);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load users');
      setUsers([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = () => {
    setSelectedUser(null);
    setUserFormOpen(true);
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setUserFormOpen(true);
  };

  const handleUserFormClose = () => {
    setUserFormOpen(false);
    setSelectedUser(null);
  };

  const handleUserSaved = () => {
    handleUserFormClose();
    loadUsers();
    setSuccess('User saved successfully');
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleOpenPasswordReset = (user) => {
    setSelectedUser(user);
    setPasswordForm({ password: '', confirmPassword: '' });
    setPasswordResetOpen(true);
  };

  const handleClosePasswordReset = () => {
    setPasswordResetOpen(false);
    setSelectedUser(null);
    setPasswordForm({ password: '', confirmPassword: '' });
  };

  const handleResetPassword = async () => {
    if (!passwordForm.password || !passwordForm.confirmPassword) {
      setError('Both password fields are required');
      return;
    }

    if (passwordForm.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (passwordForm.password !== passwordForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await usersService.resetPassword(selectedUser.username, passwordForm.password);
      handleClosePasswordReset();
      setSuccess('Password reset successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (user) => {
    try {
      setError(null);
      if (user.status === 'active') {
        await usersService.deactivateUser(user.username);
        setSuccess('User deactivated successfully');
      } else {
        await usersService.activateUser(user.username);
        setSuccess('User activated successfully');
      }
      setTimeout(() => setSuccess(null), 3000);
      loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update user status');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: { xs: 2, sm: 3 } }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Box>
        {/* Add User Button */}
        <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreateUser}
            sx={{
              backgroundColor: '#1976d2', // Primary blue
              color: '#ffffff',
              '&:hover': {
                backgroundColor: '#1565c0', // Darker blue
              },
            }}
          >
            Add New User
          </Button>
        </Box>

          {/* User Cards */}
        <Grid container spacing={3}>
          {users.map((user) => {
            const isCurrentUser = currentUser?.username === user.username;

            return (
              <Grid item xs={12} sm={6} md={4} lg={2} xl={2} key={user.username}>
                <Card sx={{ 
                  height: '100%', 
                  display: 'flex', 
                  flexDirection: 'column',
                  borderBottom: `2px ${user.status === 'active' ? 'solid' : 'dashed'} ${getUserRoleColor(user.role)}`
                }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    {/* Title with Username */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontFamily: 'monospace', flex: 1 }}>
                        {user.username}
                      </Typography>
                    </Box>

                    {/* Secondary: Name */}
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {user.first_name} {user.last_name}
                    </Typography>

                    {/* Created Date */}
                    <Typography variant="caption" color="text.secondary">
                      Created: {user.created_at
                        ? new Date(user.created_at).toLocaleDateString()
                        : '-'}
                    </Typography>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Tooltip title={isCurrentUser ? 'Cannot edit your own account' : 'Edit User'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleEditUser(user)}
                            color="primary"
                            disabled={isCurrentUser}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={isCurrentUser ? 'Cannot reset your own password here. Use Profile page.' : 'Reset Password'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleOpenPasswordReset(user)}
                            color="warning"
                            disabled={isCurrentUser}
                          >
                            <LockResetIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={isCurrentUser ? 'Cannot deactivate your own account' : user.status === 'active' ? 'Deactivate' : 'Activate'}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleToggleStatus(user)}
                            color={user.status === 'active' ? 'error' : 'success'}
                            disabled={isCurrentUser}
                          >
                            {user.status === 'active' ? <DeleteIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      {/* User Form Dialog */}
      <UserForm
        open={userFormOpen}
        onClose={handleUserFormClose}
        onSaved={handleUserSaved}
        user={selectedUser}
      />

      {/* Password Reset Dialog */}
      <Dialog open={passwordResetOpen} onClose={handleClosePasswordReset} maxWidth="sm" fullWidth>
        <DialogTitle>Reset Password for {selectedUser?.username}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="New Password"
            type="password"
            margin="normal"
            value={passwordForm.password}
            onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })}
            helperText="Must be at least 8 characters long"
          />
          <TextField
            fullWidth
            label="Confirm Password"
            type="password"
            margin="normal"
            value={passwordForm.confirmPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePasswordReset}>Cancel</Button>
          <Button
            onClick={handleResetPassword}
            variant="contained"
            disabled={saving}
          >
            {saving ? <CircularProgress size={24} /> : 'Reset Password'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SettingsUsers;
