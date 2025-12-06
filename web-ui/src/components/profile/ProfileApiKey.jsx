import React from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  InputAdornment,
  Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

const ProfileApiKey = ({
  apiKey,
  showApiKey,
  setShowApiKey,
  apiKeyCopied,
  onCopy,
  maskApiKey
}) => {
  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          API Key
        </Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Use this API key to access streaming endpoints. Keep it secure and never share it publicly.
      </Typography>

      <TextField
        fullWidth
        label="API Key"
        type={showApiKey ? 'text' : 'password'}
        value={apiKey}
        margin="normal"
        disabled
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={apiKeyCopied ? 'Copied!' : 'Copy to clipboard'}>
                <IconButton
                  onClick={onCopy}
                  edge="end"
                  aria-label="copy api key"
                >
                  <ContentCopyIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={showApiKey ? 'Hide API key' : 'Show API key'}>
                <IconButton
                  onClick={() => setShowApiKey(!showApiKey)}
                  edge="end"
                  aria-label="toggle api key visibility"
                >
                  {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          )
        }}
        helperText="Click the eye icon to reveal the full API key"
      />
    </Paper>
  );
};

export default ProfileApiKey;
