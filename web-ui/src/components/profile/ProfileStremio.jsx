import React from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  Divider
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const ProfileStremio = ({ apiKey, showApiKey, maskApiKey, onCopyUrl, hideTitle = false }) => {
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

  // Stremio API endpoints
  const endpoints = [
    {
      name: 'Manifest',
      url: `${baseUrl}/stremio/${apiKey}/manifest.json`,
      description: 'Addon manifest endpoint that defines the addon capabilities'
    },
    {
      name: 'Catalog',
      url: `${baseUrl}/stremio/${apiKey}/catalog/{type}/{id}.json`,
      description: 'Get catalog of movies or series (replace {type} with "movie", "series", or "tv" and {id} with catalog ID)'
    },
    {
      name: 'Meta',
      url: `${baseUrl}/stremio/${apiKey}/meta/{type}/{id}.json`,
      description: 'Get metadata for a specific title (replace {type} with "movie", "series", or "tv" and {id} with title ID)'
    },
    {
      name: 'Stream',
      url: `${baseUrl}/stremio/${apiKey}/stream/{type}/{id}.json`,
      description: 'Get available streams for a title (replace {type} with "movie", "series", or "tv" and {id} with title ID. For series, add ?season={season}&episode={episode})'
    }
  ];

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      {!hideTitle && (
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
          Stremio Addon
        </Typography>
      )}

      <Typography variant="body1" sx={{ mb: 3, color: 'text.primary' }}>
        Add Playarr as a Stremio addon to access all movies and TV shows directly in Stremio.
        Live TV channels are also available if configured.
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
          <strong>4.</strong> All movies and TV shows will appear in Stremio (Live TV channels available if configured)
        </Typography>
      </Box>

      {/* Debug Panel */}
      <Accordion defaultExpanded={false} sx={{ mt: 3 }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="debug-panel-content"
          id="debug-panel-header"
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
            Debug
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            List of endpoints being used for Stremio addon:
          </Typography>
          <List>
            {endpoints.map((endpoint, index) => (
              <React.Fragment key={index}>
                <ListItem
                  sx={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    pb: 2
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', flex: 1 }}>
                      {endpoint.name}
                    </Typography>
                    <Tooltip title="Copy URL">
                      <IconButton
                        size="small"
                        onClick={() => copyUrl(endpoint.url)}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      width: '100%',
                      wordBreak: 'break-all',
                      color: 'text.primary',
                      mb: 0.5
                    }}
                  >
                    {endpoint.url}
                  </Box>
                  {endpoint.description && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                      {endpoint.description}
                    </Typography>
                  )}
                </ListItem>
                {index < endpoints.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
};

export default ProfileStremio;

