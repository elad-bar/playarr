import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Grid,
  Alert,
  CircularProgress,
  IconButton,
  Tabs,
  Tab,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
  Drawer,
  Card,
  CardContent,
  CardActionArea,
  useTheme,
  useMediaQuery
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoIcon from '@mui/icons-material/Info';
import { authService } from '../services/auth';
import { useAuth } from '../context/AuthContext';
import ProfileUserDetails from './profile/ProfileUserDetails';
import ProfilePassword from './profile/ProfilePassword';
import ProfileApiKey from './profile/ProfileApiKey';
import ProfileM3UEndpoint from './profile/ProfileM3UEndpoint';
import ProfileIPTVSyncer from './profile/ProfileIPTVSyncer';
import ProfileXtreamCode from './profile/ProfileXtreamCode';
import ProfileStremio from './profile/ProfileStremio';
import ProfileLiveTV from './profile/ProfileLiveTV';

function TabPanel({ children, value, index }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`profile-tabpanel-${index}`}
      aria-labelledby={`profile-tab-${index}`}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const Profile = ({ open, onClose }) => {
  const { refreshAuth } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);


  // Only load profile when dialog opens (not on mount or when closed)
  const hasLoadedRef = useRef(false);
  
  useEffect(() => {
    if (open && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      loadProfile();
    }
    if (!open) {
      hasLoadedRef.current = false;
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps


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


  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
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

  const handleOpenClientDetails = (clientId) => {
    setSelectedClient(clientId);
    setDrawerOpen(true);
  };

  const handleCloseClientDetails = () => {
    setDrawerOpen(false);
    setSelectedClient(null);
  };

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Client configurations
  const clients = [
    {
      id: 'm3u',
      title: 'M3U8 Playlist',
      description: 'Get M3U playlist files for media players like Plex, Jellyfin, Emby, VLC, and others.'
    },
    {
      id: 'iptv-syncer',
      title: 'Strmarr',
      description: 'Generate STRM files for media clients like Emby, Jellyfin, and Kodi.'
    },
    {
      id: 'xtream-code',
      title: 'Xtream Code API',
      description: 'Access your movies and TV shows using Xtream Code API compatible clients.'
    },
    {
      id: 'stremio',
      title: 'Stremio Addon',
      description: 'Add Playarr as a Stremio addon to access all movies and TV shows directly in Stremio.'
    }
  ];


  if (!open) return null;

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth fullScreen>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" component="span">Profile</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen
      TransitionProps={{
        onExited: () => {
          // Reset state when dialog is fully closed to prevent ResizeObserver issues
          setActiveTab(0);
          setError(null);
          setSuccess(null);
          setDrawerOpen(false);
          setSelectedClient(null);
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" component="span">Profile</Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ py: 3 }}>
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

          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={activeTab}
              onChange={handleTabChange}
              aria-label="profile tabs"
            >
              <Tab label="User Details" />
              <Tab label="LiveTV" />
              <Tab label="Client" />
            </Tabs>
          </Box>

          {/* User Details Tab - 3 columns */}
          <TabPanel value={activeTab} index={0}>
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
          </TabPanel>

          {/* LiveTV Tab */}
          <TabPanel value={activeTab} index={1}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <ProfileLiveTV
                  profile={profile}
                  onUpdate={loadProfile}
                />
              </Grid>
            </Grid>
          </TabPanel>

          {/* Client Tab - 4 columns layout */}
          <TabPanel value={activeTab} index={2}>
            <Grid container spacing={3}>
              {clients.map((client) => (
                <Grid item xs={12} sm={6} md={3} key={client.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow: 6
                      }
                    }}
                  >
                    <CardActionArea
                      onClick={() => handleOpenClientDetails(client.id)}
                      sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="h6" sx={{ fontWeight: 'bold', flex: 1 }}>
                            {client.title}
                          </Typography>
                          <IconButton
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenClientDetails(client.id);
                            }}
                            color="primary"
                            aria-label="View details"
                            size="small"
                            sx={{ ml: 1 }}
                          >
                            <InfoIcon />
                          </IconButton>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {client.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </TabPanel>
        </Box>
      </DialogContent>
    </Dialog>

      {/* Client Details Drawer - Outside Dialog for proper z-index */}
      <Drawer
        anchor="right"
        open={drawerOpen && open}
        onClose={handleCloseClientDetails}
        variant="temporary"
        ModalProps={{
          style: { zIndex: 1400 }
        }}
        PaperProps={{
          sx: {
            width: isMobile ? '100%' : 600,
            maxWidth: '100%',
            zIndex: 1400
          }
        }}
      >
        <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              {clients.find(c => c.id === selectedClient)?.title || 'Client Details'}
            </Typography>
            <IconButton onClick={handleCloseClientDetails} aria-label="Close">
              <CloseIcon />
            </IconButton>
          </Box>

          {selectedClient === 'm3u' && (
            <ProfileM3UEndpoint
              apiKey={profile.api_key}
              showApiKey={showApiKey}
              maskApiKey={maskApiKey}
              hideTitle={true}
              profile={profile}
              onCopyUrl={() => {
                setApiKeyCopied(true);
                setTimeout(() => setApiKeyCopied(false), 2000);
              }}
            />
          )}

          {selectedClient === 'iptv-syncer' && (
            <ProfileIPTVSyncer apiKey={profile.api_key} hideTitle={true} />
          )}

          {selectedClient === 'xtream-code' && (
            <ProfileXtreamCode
              apiKey={profile.api_key}
              username={profile.username}
              showApiKey={showApiKey}
              maskApiKey={maskApiKey}
              hideTitle={true}
              onCopyUrl={() => {
                setApiKeyCopied(true);
                setTimeout(() => setApiKeyCopied(false), 2000);
              }}
            />
          )}

          {selectedClient === 'stremio' && (
            <ProfileStremio
              apiKey={profile.api_key}
              showApiKey={showApiKey}
              maskApiKey={maskApiKey}
              hideTitle={true}
              onCopyUrl={() => {
                setApiKeyCopied(true);
                setTimeout(() => setApiKeyCopied(false), 2000);
              }}
            />
          )}
        </Box>
      </Drawer>
    </>
  );
};

export default Profile;
