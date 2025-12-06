import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Alert,
  CircularProgress,
} from '@mui/material';
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
  const [changingPassword, setChangingPassword] = useState(false);
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
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      await authService.updateProfile({
        first_name: profile.first_name,
        last_name: profile.last_name
      });

      // Update original values after successful save
      setOriginalProfile({
        first_name: profile.first_name,
        last_name: profile.last_name
      });

      // Refresh auth context to get updated user info
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

  const handleChangePassword = async () => {
    // Validation
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

    try {
      setChangingPassword(true);
      setError(null);
      setSuccess(null);

      await authService.changePassword(
        passwordForm.current_password,
        passwordForm.new_password
      );

      // Clear password form after successful change
      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: ''
      });

      setSuccess('Password changed successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const maskApiKey = (key) => {
    if (!key) return '';
    if (key.length <= 8) return key;
    return key.substring(0, 4) + '•'.repeat(4) + key.substring(key.length - 4);
  };


  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
    <Box sx={{ p: 3 }}>
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
                onSave={handleSave}
                saving={saving}
                isDirty={
                  profile.first_name !== originalProfile.first_name ||
                  profile.last_name !== originalProfile.last_name
                }
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <ProfilePassword
                passwordForm={passwordForm}
                setPasswordForm={setPasswordForm}
                showPasswords={showPasswords}
                setShowPasswords={setShowPasswords}
                onChangePassword={handleChangePassword}
                changingPassword={changingPassword}
                isDirty={
                  !!passwordForm.current_password ||
                  !!passwordForm.new_password ||
                  !!passwordForm.confirm_password
                }
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <ProfileApiKey
                apiKey={profile.api_key}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
                apiKeyCopied={apiKeyCopied}
                onCopy={handleCopyApiKey}
                onRegenerate={handleRegenerateApiKey}
                regenerating={regenerating}
                maskApiKey={maskApiKey}
              />
            </Grid>
          </Grid>
    </Box>
    </>
  );
};

export default Profile;
