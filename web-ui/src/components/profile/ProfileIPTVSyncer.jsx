import React from 'react';
import {
  Box,
  Paper,
  Typography
} from '@mui/material';

const ProfileIPTVSyncer = ({ apiKey }) => {
  return (
    <Paper elevation={3} sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 2 }}>
        IPTV Syncer Deployment
      </Typography>

      <Typography variant="body1" sx={{ mb: 3, color: 'text.primary' }}>
        Use this endpoint URL with iptv-syncer to sync your media files. The endpoint returns a JSON
        mapping of file paths to stream URLs for all titles in your watchlist.{' '}
        <Typography
          component="a"
          href="https://gitlab.com/elad.bar/iptv-syncer"
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            color: 'primary.main',
            textDecoration: 'none',
            '&:hover': {
              textDecoration: 'underline'
            }
          }}
        >
          Learn more about iptv-syncer
        </Typography>
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, color: 'text.primary' }}>
          Base URL:
        </Typography>
        <Box
          sx={{
            p: 1.5,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            color: 'text.primary',
            wordBreak: 'break-all'
          }}
        >
          {window.location.origin}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
          The app will automatically build the full endpoint path using your API key
        </Typography>
      </Box>

      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: 'text.primary' }}>
        Docker Compose (Recommended)
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Create a <Box component="span" sx={{ fontFamily: 'monospace', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100', px: 0.5 }}>docker-compose.yml</Box> file:
        </Typography>
        <Box
          sx={{
            p: 2,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: 'text.primary',
            overflowX: 'auto'
          }}
        >
          <Box component="pre" sx={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`version: '3.8'

services:
  iptv-syncer:
    image: "registry.gitlab.com/elad.bar/iptv-syncer:latest"
    restart: unless-stopped
    user: "root"
    environment:
      - MEDIA_PATH=/app
      - SYNC_BASE_URL=${window.location.origin}
      - IPTV_MANAGER_API_KEY=${apiKey}
      - SYNC_INTERVAL=0 * * * *
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
      - ./media:/app/media`}
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Then run: <Box component="span" sx={{ fontFamily: 'monospace', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100', px: 0.5 }}>docker-compose up -d --build</Box>
        </Typography>
      </Box>

      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: 'text.primary' }}>
        Docker CLI
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Box
          sx={{
            p: 2,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: 'text.primary',
            overflowX: 'auto'
          }}
        >
          <Box component="pre" sx={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{`docker run -d \\
  --name iptv-syncer \\
  --restart unless-stopped \\
  -e MEDIA_PATH=/app \\
  -e SYNC_BASE_URL="${window.location.origin}" \\
  -e IPTV_MANAGER_API_KEY="${apiKey}" \\
  -e SYNC_INTERVAL="0 * * * *" \\
  -v /etc/localtime:/etc/localtime:ro \\
  -v /etc/timezone:/etc/timezone:ro \\
  -v ./media:/app/media \\
  registry.gitlab.com/elad.bar/iptv-syncer:latest`}
          </Box>
        </Box>
      </Box>

      <Box sx={{ mt: 2, p: 2, bgcolor: 'warning.light', borderRadius: 1, border: '1px solid', borderColor: 'warning.main' }}>
        <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 'bold', mb: 0.5 }}>
          Note:
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.primary' }}>
          Replace <Box component="span" sx={{ fontFamily: 'monospace' }}>./media</Box> with your actual media directory path.
          Update <Box component="span" sx={{ fontFamily: 'monospace' }}>SYNC_INTERVAL</Box> to your desired cron schedule (format: minute hour day month weekday).
        </Typography>
      </Box>
    </Paper>
  );
};

export default ProfileIPTVSyncer;
