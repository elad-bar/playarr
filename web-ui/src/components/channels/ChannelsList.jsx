import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  CircularProgress,
  Grid,
  useTheme,
  IconButton,
  Tooltip,
  CardActions
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import axiosInstance from '../../config/axios';
import { API_URL } from '../../config';
import { authService } from '../../services/auth';

// Base64 encoded placeholder image (1x1 transparent pixel)
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Utility function to sanitize image URLs
const sanitizeImageUrl = (url) => {
  if (!url) return PLACEHOLDER_IMAGE;
  const cleanUrl = url.split('https://').pop();
  return cleanUrl ? `https://${cleanUrl}` : PLACEHOLDER_IMAGE;
};

/**
 * ChannelsList component for displaying Live TV channels in a grid
 */
const ChannelsList = () => {
  const theme = useTheme();
  const { isAuthenticated, user } = useAuth();
  const [apiKey, setApiKey] = useState(null);
  const [copiedChannelId, setCopiedChannelId] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch channels when component mounts or user changes
  useEffect(() => {
    if (isAuthenticated && user) {
      // Fetch channels for the current user
      const loadChannels = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await axiosInstance.get('/livetv/channels');
          setChannels(response.data);
        } catch (err) {
          setError(err.response?.data?.error || 'Failed to fetch channels');
          setChannels([]);
        } finally {
          setLoading(false);
        }
      };

      loadChannels();

      // Load API key from user object or profile
      const loadApiKey = async () => {
        if (user?.api_key) {
          setApiKey(user.api_key);
        } else {
          try {
            const profile = await authService.getProfile();
            setApiKey(profile.api_key);
          } catch (error) {
            console.error('Failed to load API key:', error);
          }
        }
      };
      loadApiKey();
    } else {
      // Clear channels when user logs out
      setChannels([]);
      setError(null);
    }
  }, [isAuthenticated, user]); // Re-fetch when user changes

  /**
   * Get stream URL for a channel
   * @param {string} channelId - Channel ID
   * @returns {string|null} Stream URL or null if API key not available
   */
  const getStreamUrl = (channelId) => {
    if (!apiKey) return null;
    
    // Check if API_URL is already a full URL (starts with http:// or https://)
    let apiBase;
    if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
      // API_URL is already a full URL, use it directly
      apiBase = API_URL.replace(/\/$/, ''); // Remove trailing slash if present
    } else {
      // API_URL is a relative path, combine with window.location.origin
      const baseUrl = window.location.origin;
      const apiPath = API_URL.replace(/\/$/, ''); // Remove trailing slash if present
      apiBase = `${baseUrl}${apiPath}`;
    }
    
    const encodedChannelId = encodeURIComponent(channelId);
    return `${apiBase}/livetv/stream/${encodedChannelId}?api_key=${apiKey}`;
  };

  /**
   * Handle opening stream in new tab
   * @param {string} channelId - Channel ID
   */
  const handleOpenInNewTab = (channelId) => {
    const streamUrl = getStreamUrl(channelId);
    if (streamUrl) {
      window.open(streamUrl, '_blank', 'noopener,noreferrer');
    }
  };

  /**
   * Handle copying stream URL to clipboard
   * @param {string} channelId - Channel ID
   */
  const handleCopyUrl = async (channelId) => {
    const streamUrl = getStreamUrl(channelId);
    if (streamUrl) {
      try {
        await navigator.clipboard.writeText(streamUrl);
        setCopiedChannelId(channelId);
        setTimeout(() => setCopiedChannelId(null), 2000);
      } catch (error) {
        console.error('Failed to copy URL:', error);
      }
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Error loading channels: {error}</Typography>
      </Box>
    );
  }

  if (!channels || channels.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          No Live TV Channels
        </Typography>
        <Typography color="text.secondary">
          Configure your Live TV M3U URL in your profile to start viewing channels.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
        Live TV Channels
      </Typography>
      <Grid container spacing={3}>
        {channels.map((channel) => {
          const streamUrl = getStreamUrl(channel.channel_id);
          const isCopied = copiedChannelId === channel.channel_id;
          
          return (
            <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={channel.channel_id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: theme.shadows[8]
                  }
                }}
              >
                {channel.tvg_logo && (
                  <CardMedia
                    component="img"
                    height="140"
                    image={sanitizeImageUrl(channel.tvg_logo)}
                    alt={channel.name}
                    sx={{
                      objectFit: 'contain',
                      bgcolor: 'background.paper',
                      p: 1
                    }}
                    onError={(e) => {
                      e.target.src = PLACEHOLDER_IMAGE;
                    }}
                  />
                )}
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" component="div" gutterBottom noWrap>
                    {channel.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    ID: {channel.channel_id}
                  </Typography>
                  {channel.currentProgram && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Now Playing:
                      </Typography>
                      <Typography variant="body2" component="div" sx={{ fontWeight: 'medium' }}>
                        {channel.currentProgram.title}
                      </Typography>
                      {channel.currentProgram.desc && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                          {channel.currentProgram.desc.length > 100
                            ? `${channel.currentProgram.desc.substring(0, 100)}...`
                            : channel.currentProgram.desc}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {channel.group_title && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {channel.group_title}
                    </Typography>
                  )}
                </CardContent>
                <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                  <Tooltip title={isCopied ? 'URL Copied!' : 'Copy Stream URL'}>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyUrl(channel.channel_id);
                      }}
                      disabled={!streamUrl}
                      color={isCopied ? 'success' : 'default'}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Open Stream in New Tab">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenInNewTab(channel.channel_id);
                      }}
                      disabled={!streamUrl}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};

export default ChannelsList;

