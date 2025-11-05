import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Box,
  MenuItem
} from '@mui/material';
import { usersService } from '../../../services/users';

const UserForm = ({ open, onClose, onSaved, user }) => {
  const [formData, setFormData] = useState({
    username: '',
    first_name: '',
    last_name: '',
    password: '',
    role: 'user'
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const isEditing = !!user;

  useEffect(() => {
    if (user) {
      setFormData({
        username: user.username || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        password: '',
        role: user.role || 'user'
      });
    } else {
      setFormData({
        username: '',
        first_name: '',
        last_name: '',
        password: '',
        role: 'user'
      });
    }
    setError(null);
  }, [user, open]);

  const handleChange = (field) => (e) => {
    setFormData({ ...formData, [field]: e.target.value });
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);

    // Validation
    if (!formData.username || !formData.first_name || !formData.last_name) {
      setError('Username, first name, and last name are required');
      return;
    }

    if (!isEditing && !formData.password) {
      setError('Password is required when creating a new user');
      return;
    }

    if (formData.password && formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    try {
      setSaving(true);

      if (isEditing) {
        // Update existing user
        await usersService.updateUser(user.username, {
          first_name: formData.first_name,
          last_name: formData.last_name,
          role: formData.role
        });
      } else {
        // Create new user
        await usersService.createUser({
          username: formData.username,
          first_name: formData.first_name,
          last_name: formData.last_name,
          password: formData.password,
          role: formData.role
        });
      }

      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? 'Edit User' : 'Create New User'}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            fullWidth
            label="Username"
            margin="normal"
            value={formData.username}
            onChange={handleChange('username')}
            disabled={isEditing}
            required
            helperText={isEditing ? 'Username cannot be changed' : 'Username must be unique'}
          />

          <TextField
            fullWidth
            label="First Name"
            margin="normal"
            value={formData.first_name}
            onChange={handleChange('first_name')}
            required
          />

          <TextField
            fullWidth
            label="Last Name"
            margin="normal"
            value={formData.last_name}
            onChange={handleChange('last_name')}
            required
          />

          {!isEditing && (
            <TextField
              fullWidth
              label="Password"
              type="password"
              margin="normal"
              value={formData.password}
              onChange={handleChange('password')}
              required
              helperText="Must be at least 8 characters long"
            />
          )}

          <TextField
            fullWidth
            select
            label="Role"
            margin="normal"
            value={formData.role}
            onChange={handleChange('role')}
            required
          >
            <MenuItem value="user">User</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
          </TextField>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? <CircularProgress size={24} /> : isEditing ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserForm;
