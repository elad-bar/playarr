import React from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Divider
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

const ProfileXtreamCode = ({ apiKey, username, showApiKey, maskApiKey, onCopyUrl, hideTitle = false }) => {
  const baseUrl = window.location.origin;
  const xtreamUrl = baseUrl;
  
  const copyUrl = (text) => {
    navigator.clipboard.writeText(text);
    onCopyUrl();
  };

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      {!hideTitle && (
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
          Xtream Code API
        </Typography>
      )}

      <Typography variant="body1" sx={{ mb: 3, color: 'text.primary' }}>
        Access your movies and TV shows using Xtream Code API compatible clients like TiviMate, 
        Perfect Player, IPTV Smarters, and others. Use your username and API key as credentials.
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Server URL
        </Typography>
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
            color: 'text.primary',
            mb: 2
          }}
        >
          <Box component="span" sx={{ flex: 1, pr: 1 }}>
            {xtreamUrl}
          </Box>
          <Tooltip title="Copy URL">
            <IconButton
              size="small"
              onClick={() => copyUrl(xtreamUrl)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Credentials
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
              color: 'text.primary'
            }}
          >
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Username:
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box component="span">{username}</Box>
                <Tooltip title="Copy username">
                  <IconButton
                    size="small"
                    onClick={() => copyUrl(username)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Password (API Key):
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box component="span">{showApiKey ? apiKey : maskApiKey(apiKey)}</Box>
                <Tooltip title="Copy API key">
                  <IconButton
                    size="small"
                    onClick={() => copyUrl(apiKey)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
        <Typography variant="body1" sx={{ fontWeight: 'bold', mb: 1, color: 'text.primary' }}>
          How to Use:
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>1.</strong> Enter the Server URL in your Xtream Code compatible client
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>2.</strong> Use your username and API key as login credentials
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>3.</strong> The client will automatically fetch movies and TV shows
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary' }}>
          <strong>4.</strong> Supported actions: get_vod_categories, get_vod_streams, get_series_categories, get_series, get_vod_info, get_series_info
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProfileXtreamCode;

