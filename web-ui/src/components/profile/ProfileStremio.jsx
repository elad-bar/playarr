import React from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Button
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const ProfileStremio = ({ apiKey, showApiKey, maskApiKey, onCopyUrl }) => {
  const baseUrl = window.location.origin;
  const stremioManifestUrl = `${baseUrl}/stremio/${apiKey}/manifest.json`;
  
  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    onCopyUrl();
  };

  const openStremio = () => {
    // Stremio uses a special protocol handler
    window.open(`stremio://${stremioManifestUrl.replace(/^https?:\/\//, '')}`, '_blank');
  };

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
        Stremio Addon
      </Typography>

      <Typography variant="body1" sx={{ mb: 3, color: 'text.primary' }}>
        Add Playarr as a Stremio addon to access your watchlist movies and TV shows directly in Stremio.
        The addon shows only titles from your watchlist.
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, color: 'text.primary' }}>
          Manifest URL
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
            {baseUrl}/stremio/{showApiKey ? apiKey : maskApiKey(apiKey)}/manifest.json
          </Box>
          <Tooltip title="Copy URL">
            <IconButton
              size="small"
              onClick={() => copyUrl(stremioManifestUrl)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ mb: 3 }}>
        <Button
          variant="contained"
          fullWidth
          startIcon={<OpenInNewIcon />}
          onClick={openStremio}
          sx={{ mb: 1 }}
        >
          Open in Stremio
        </Button>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
          Requires Stremio desktop app to be installed
        </Typography>
      </Box>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1, border: '1px solid', borderColor: 'info.main' }}>
        <Typography variant="body1" sx={{ fontWeight: 'bold', mb: 1, color: 'text.primary' }}>
          How to Add:
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>1.</strong> Copy the Manifest URL above
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>2.</strong> Open Stremio and go to Addons
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary', mb: 1 }}>
          <strong>3.</strong> Click "Add Addon" and paste the URL
        </Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.primary' }}>
          <strong>4.</strong> Your watchlist movies and TV shows will appear in Stremio
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProfileStremio;

