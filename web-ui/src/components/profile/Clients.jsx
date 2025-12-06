import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  IconButton,
  Drawer,
  useTheme,
  useMediaQuery,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoIcon from '@mui/icons-material/Info';
import { authService } from '../../services/auth';
import ProfileM3UEndpoint from './ProfileM3UEndpoint';
import ProfileIPTVSyncer from './ProfileIPTVSyncer';
import ProfileXtreamCode from './ProfileXtreamCode';
import ProfileStremio from './ProfileStremio';

/**
 * Clients page component
 * Displays client configuration options (M3U, Strmarr, Xtream Code, Stremio)
 */
function Clients() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({
    username: '',
    api_key: '',
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [showApiKey] = useState(false);
  const [, setApiKeyCopied] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Load profile on mount
  useEffect(() => {
    loadProfile();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await authService.getProfile();
      setProfile(data);
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
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
      </Box>

      {/* Client Details Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
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
}

export default Clients;
