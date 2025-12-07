import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Alert,
  CircularProgress,
  Button,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import { authService } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import ProfileUserDetails from './profile/ProfileUserDetails';
import ProfilePassword from './profile/ProfilePassword';
import ProfileApiKey from './profile/ProfileApiKey';

const Profile = () => {
  const { refreshAuth } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [profile, setProfile] = useState({
    username: '',
    first_name: '',
    last_name: '',
    api_key: '',
    role: '',
    watchlist: []
  });
  const [originalProfile, setOriginalProfile] = useState({
    first_name: '',
    last_name: ''
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });


  // Load profile on mount
  useEffect(() => {
    loadProfile();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const loadProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await authService.getProfile();
      setProfile(data);
      // Store original values for dirty check
      setOriginalProfile({
        first_name: data.first_name || '',
        last_name: data.last_name || ''
      });
    } catch (err) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };


  const handleSave = async () => {
    // Check if password form is filled and valid
    const hasPasswordChanges = 
      passwordForm.current_password || 
      passwordForm.new_password || 
      passwordForm.confirm_password;
    
    if (hasPasswordChanges) {
      // Validate password fields
      if (!passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password) {
        setError('All password fields are required');
        return;
      }
      if (passwordForm.new_password.length < 8) {
        setError('New password must be at least 8 characters long');
        return;
      }
      if (passwordForm.new_password !== passwordForm.confirm_password) {
        setError('New passwords do not match');
        return;
      }
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const promises = [];

      // Save user details if changed
      if (profile.first_name !== originalProfile.first_name || 
          profile.last_name !== originalProfile.last_name) {
        promises.push(
          authService.updateProfile({
            first_name: profile.first_name,
            last_name: profile.last_name
          })
        );
      }

      // Change password if form is filled
      if (hasPasswordChanges) {
        promises.push(
          authService.changePassword(
            passwordForm.current_password,
            passwordForm.new_password
          )
        );
      }

      // Execute all saves
      await Promise.all(promises);

      // Update original values after successful save
      setOriginalProfile({
        first_name: profile.first_name,
        last_name: profile.last_name
      });

      // Clear password form after successful save
      if (hasPasswordChanges) {
        setPasswordForm({
          current_password: '',
          new_password: '',
          confirm_password: ''
        });
      }

      // Refresh auth context
      await refreshAuth();

      setSuccess('Profile updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateApiKey = async () => {
    if (!window.confirm('Are you sure you want to regenerate your API key? You will need to update it in all applications that use it (Plex, Jellyfin, Emby, etc.).')) {
      return;
    }

    try {
      setRegenerating(true);
      setError(null);
      setSuccess(null);

      const data = await authService.regenerateApiKey();
      setProfile(prev => ({ ...prev, api_key: data.api_key }));

      // Refresh auth context
      await refreshAuth();

      setSuccess('API key regenerated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to regenerate API key');
    } finally {
      setRegenerating(false);
    }
  };

  const handleCopyApiKey = () => {
    navigator.clipboard.writeText(profile.api_key);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  };


  const maskApiKey = (key) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return key.substring(0, 4) + '•'.repeat(4) + key.substring(key.length - 4);
  };

  // Check if any values are dirty (changed)
  const isDirty = 
    profile.first_name !== originalProfile.first_name ||
    profile.last_name !== originalProfile.last_name ||
    !!passwordForm.current_password ||
    !!passwordForm.new_password ||
    !!passwordForm.confirm_password;


  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: { xs: 2, sm: 3 } }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Save and Regenerate Buttons */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={!isDirty || saving}
          sx={{
            minWidth: '120px',
            backgroundColor: isDirty && !saving ? '#1976d2' : '#bdbdbd',
            color: isDirty && !saving ? '#ffffff' : '#424242',
            '&:hover': {
              backgroundColor: isDirty && !saving ? '#1565c0' : '#bdbdbd',
            },
            '&:disabled': {
              backgroundColor: '#bdbdbd',
              color: '#424242',
              opacity: 1,
            },
          }}
        >
          Save
        </Button>
        <Button
          variant="contained"
          startIcon={regenerating ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
          onClick={handleRegenerateApiKey}
          disabled={regenerating}
          sx={{
            minWidth: '160px',
            backgroundColor: regenerating ? '#bdbdbd' : '#ff9800', // Orange/warning color
            color: '#ffffff',
            '&:hover': {
              backgroundColor: regenerating ? '#bdbdbd' : '#f57c00', // Darker orange
            },
            '&:disabled': {
              backgroundColor: '#bdbdbd',
              color: '#424242',
              opacity: 1,
            },
          }}
        >
          {regenerating ? 'Regenerating...' : 'Regenerate API Key'}
        </Button>
      </Box>

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

      {/* User Details - 3 columns */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <ProfileUserDetails
            profile={profile}
            setProfile={setProfile}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <ProfilePassword
            passwordForm={passwordForm}
            setPasswordForm={setPasswordForm}
            showPasswords={showPasswords}
            setShowPasswords={setShowPasswords}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <ProfileApiKey
            apiKey={profile.api_key}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            apiKeyCopied={apiKeyCopied}
            onCopy={handleCopyApiKey}
            maskApiKey={maskApiKey}
          />
        </Grid>
      </Grid>
    </Box>
    </>
  );
};

export default Profile;
