import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import ClearIcon from '@mui/icons-material/Clear';
import axiosInstance from '../../config/axios';

/**
 * ProfileLiveTV component for configuring Live TV M3U and EPG URLs
 */
const ProfileLiveTV = ({ profile, onUpdate }) => {
  const [m3uUrl, setM3uUrl] = useState(profile?.liveTV?.m3u_url || '');
  const [epgUrl, setEpgUrl] = useState(profile?.liveTV?.epg_url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Update local state when profile prop changes
  useEffect(() => {
    const newM3uUrl = profile?.liveTV?.m3u_url || '';
    const newEpgUrl = profile?.liveTV?.epg_url || '';
    setM3uUrl(newM3uUrl);
    setEpgUrl(newEpgUrl);
  }, [profile?.liveTV?.m3u_url, profile?.liveTV?.epg_url]);

  const isDirty = 
    m3uUrl !== (profile?.liveTV?.m3u_url || '') ||
    epgUrl !== (profile?.liveTV?.epg_url || '');

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const liveTV = {
        m3u_url: m3uUrl.trim() || null,
        epg_url: epgUrl.trim() || null
      };

      // Remove epg_url if empty
      if (!liveTV.epg_url) {
        delete liveTV.epg_url;
      }

      await axiosInstance.put('/profile', { liveTV });

      setSuccess('Live TV configuration saved successfully');
      setTimeout(() => setSuccess(null), 3000);
      
      if (onUpdate) {
        await onUpdate();
      }
    } catch (err) {
      setError(err.message || 'Failed to save Live TV configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      await axiosInstance.put('/profile', { liveTV: { m3u_url: null, epg_url: null } });

      setM3uUrl('');
      setEpgUrl('');
      setSuccess('Live TV configuration cleared successfully');
      setTimeout(() => setSuccess(null), 3000);
      
      if (onUpdate) {
        await onUpdate();
      }
    } catch (err) {
      setError(err.message || 'Failed to clear Live TV configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Live TV Configuration
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Clear configuration">
            <IconButton
              color="error"
              onClick={handleClear}
              disabled={saving || (!m3uUrl && !epgUrl)}
            >
              <ClearIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={saving ? 'Saving...' : isDirty ? 'Save changes' : 'No changes to save'}>
            <span>
              <IconButton
                color="primary"
                onClick={handleSave}
                disabled={!isDirty || saving}
                sx={{
                  bgcolor: (theme) => isDirty && !saving ? theme.palette.primary.main : 'transparent',
                  color: (theme) => isDirty && !saving ? theme.palette.primary.contrastText : 'inherit',
                  '&:hover': {
                    bgcolor: (theme) => isDirty && !saving ? theme.palette.primary.dark : 'transparent'
                  }
                }}
              >
                {saving ? <CircularProgress size={24} /> : <SaveIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
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

      <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
        Configure your Live TV M3U playlist and EPG (Electronic Program Guide) URLs.
        The system will automatically sync channels and program information.
      </Typography>

      <TextField
        fullWidth
        label="M3U URL"
        value={m3uUrl}
        onChange={(e) => setM3uUrl(e.target.value)}
        margin="normal"
        required
        placeholder="https://example.com/playlist.m3u"
        helperText="URL to your M3U playlist file (required)"
      />

      <TextField
        fullWidth
        label="EPG URL"
        value={epgUrl}
        onChange={(e) => setEpgUrl(e.target.value)}
        margin="normal"
        placeholder="https://example.com/epg.xml or https://example.com/epg.xml.gz"
        helperText="URL to your EPG XML file (optional, supports .xml and .xml.gz)"
      />

      <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
        <Typography variant="body2" sx={{ color: 'text.primary' }}>
          <strong>Note:</strong> After saving, the system will automatically sync your Live TV channels and EPG data.
          The sync runs every 6 hours or immediately after configuration changes.
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProfileLiveTV;

