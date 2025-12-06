import React from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const ProfileM3UEndpoint = ({ apiKey, showApiKey, maskApiKey, onCopyUrl, hideTitle = false, profile = null }) => {
  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    onCopyUrl();
  };

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      {!hideTitle && (
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
          M3U8 Playlist
        </Typography>
      )}

      <Typography variant="body1" sx={{ mb: 3, color: 'text.primary' }}>
        Get M3U playlist files for media players like Plex, Jellyfin, Emby, VLC, and others.
        The playlist contains all titles from your watchlist.
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Movies Playlist
        </Typography>
        <Box sx={{ mb: 1.5 }}>
          <Box
            sx={{
              p: 2,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              wordBreak: 'break-all',
              color: 'text.primary'
            }}
          >
            <Box component="span" sx={{ flex: 1, pr: 1 }}>
              {window.location.origin}/api/playlist/movies?api_key={showApiKey ? apiKey : maskApiKey(apiKey)}
            </Box>
            <Tooltip title="Copy URL">
              <IconButton
                size="small"
                onClick={() => copyUrl(`${window.location.origin}/api/playlist/movies?api_key=${apiKey}`)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          TV Shows Playlist
        </Typography>
        <Box>
          <Box
            sx={{
              p: 2,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              wordBreak: 'break-all',
              color: 'text.primary'
            }}
          >
            <Box component="span" sx={{ flex: 1, pr: 1 }}>
              {window.location.origin}/api/playlist/tvshows?api_key={showApiKey ? apiKey : maskApiKey(apiKey)}
            </Box>
            <Tooltip title="Copy URL">
              <IconButton
                size="small"
                onClick={() => copyUrl(`${window.location.origin}/api/playlist/tvshows?api_key=${apiKey}`)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 3, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Live TV M3U Playlist
        </Typography>
        <Box sx={{ mb: 1.5 }}>
          <Box
            sx={{
              p: 2,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              wordBreak: 'break-all',
              color: 'text.primary'
            }}
          >
            <Box component="span" sx={{ flex: 1, pr: 1 }}>
              {window.location.origin}/api/livetv/m3u?api_key={showApiKey ? apiKey : maskApiKey(apiKey)}
            </Box>
            <Tooltip title="Copy URL">
              <IconButton
                size="small"
                onClick={() => copyUrl(`${window.location.origin}/api/livetv/m3u?api_key=${apiKey}`)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Live TV EPG XML
        </Typography>
        <Box>
          <Box
            sx={{
              p: 2,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              wordBreak: 'break-all',
              color: 'text.primary'
            }}
          >
            <Box component="span" sx={{ flex: 1, pr: 1 }}>
              {window.location.origin}/api/livetv/epg?api_key={showApiKey ? apiKey : maskApiKey(apiKey)}
            </Box>
            <Tooltip title="Copy URL">
              <IconButton
                size="small"
                onClick={() => copyUrl(`${window.location.origin}/api/livetv/epg?api_key=${apiKey}`)}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
        <Typography variant="body1" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.primary' }}>
          Response:
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.primary' }}>
          Returns an M3U playlist file (text/plain format) containing all titles from your watchlist.
          You can use this URL directly in your media player.
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProfileM3UEndpoint;
