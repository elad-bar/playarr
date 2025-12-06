import React, { useState, useEffect } from 'react';
import {
  Box,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
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
  const [selectedTab, setSelectedTab] = useState(0);
  const [showApiKey] = useState(false);
  const [, setApiKeyCopied] = useState(false);

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

  const handleTabChange = (event, newValue) => {
    setSelectedTab(newValue);
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
      title: 'Xtream Code',
      description: 'Access your movies and TV shows using Xtream Code API compatible clients.'
    },
    {
      id: 'stremio',
      title: 'Stremio',
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
    <Box sx={{ width: '100%' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={selectedTab}
          onChange={handleTabChange}
          aria-label="client configuration tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          {clients.map((client, index) => (
            <Tab key={client.id} label={client.title} id={`tab-${index}`} aria-controls={`tabpanel-${index}`} />
          ))}
        </Tabs>
      </Box>

      {/* Tab Content */}
      <Box sx={{ p: 3 }}>
        {selectedTab === 0 && (
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

        {selectedTab === 1 && (
          <ProfileIPTVSyncer apiKey={profile.api_key} hideTitle={true} />
        )}

        {selectedTab === 2 && (
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

        {selectedTab === 3 && (
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
    </Box>
  );
}

export default Clients;
