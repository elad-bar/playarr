import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
  InputLabel,
  CircularProgress,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { validateIPTVProviderCredentials } from '../utils';

/**
 * ProviderDetailsStep - Step 2 (add) / Step 1 (edit)
 * @param {Object|null} provider - Provider object (for edit mode)
 * @param {boolean} isAddMode - Whether in add mode
 * @param {Object} data - Step data { urls, apiUrlIndex, username, password }
 * @param {Function} onChange - Callback when data changes
 * @param {Object} errors - Validation errors
 * @param {Function} onValidate - Callback to trigger validation
 * @param {boolean} isValidating - Whether credential validation is in progress
 * @param {Function} setIsValidating - Set validation state
 */
function ProviderDetailsStep({
  provider,
  isAddMode,
  data,
  onChange,
  errors,
  onValidate,
  isValidating,
  setIsValidating,
}) {
  // Initialize from provider if in edit mode
  const [urls, setUrls] = useState(data?.urls || (provider?.streams_urls || []));
  const [apiUrlIndex, setApiUrlIndex] = useState(
    data?.apiUrlIndex !== undefined
      ? data.apiUrlIndex
      : provider?.api_url && provider?.streams_urls
      ? provider.streams_urls.findIndex(url => url === provider.api_url)
      : 0
  );
  const [username, setUsername] = useState(data?.username || provider?.username || '');
  const [password, setPassword] = useState(data?.password || provider?.password || '');
  const [newUrl, setNewUrl] = useState('');
  const [validationError, setValidationError] = useState(null);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const providerType = provider?.type?.toLowerCase() || 'xtream';

  const isXtream = providerType === 'xtream';

  // Update parent when data changes
  useEffect(() => {
    onChange({
      urls,
      apiUrlIndex,
      username,
      password,
    });
  }, [urls, apiUrlIndex, username, password, onChange]);

  // Validate credentials
  const validateCredentials = async () => {
    if (urls.length === 0 || !username.trim() || !password.trim()) {
      return false;
    }

    const apiUrl = urls[apiUrlIndex] || urls[0];
    if (!apiUrl) {
      return false;
    }

    setIsValidating(true);
    setValidationError(null);
    setValidationSuccess(false);

    try {
      const result = await validateIPTVProviderCredentials(
        apiUrl,
        username.trim(),
        password.trim(),
        providerType
      );

      if (result.success && result.valid) {
        setValidationSuccess(true);
        setValidationError(null);
        return true;
      } else {
        setValidationError(result.error || 'Invalid credentials');
        setValidationSuccess(false);
        return false;
      }
    } catch (error) {
      setValidationError(error.message || 'Failed to validate credentials');
      setValidationSuccess(false);
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  // Handle URL add
  const handleAddUrl = () => {
    if (newUrl.trim()) {
      const newUrls = [...urls, newUrl.trim()];
      const newApiUrlIndex = urls.length === 0 ? 0 : apiUrlIndex;
      setUrls(newUrls);
      setApiUrlIndex(newApiUrlIndex);
      setNewUrl('');
      setValidationSuccess(false);
      setValidationError(null);
    }
  };

  // Handle URL remove
  const handleRemoveUrl = (index) => {
    const newUrls = urls.filter((_, i) => i !== index);
    let newApiUrlIndex = apiUrlIndex;

    if (index < apiUrlIndex) {
      newApiUrlIndex = apiUrlIndex - 1;
    } else if (index === apiUrlIndex) {
      newApiUrlIndex = 0;
    }

    if (newApiUrlIndex >= newUrls.length && newUrls.length > 0) {
      newApiUrlIndex = newUrls.length - 1;
    } else if (newUrls.length === 0) {
      newApiUrlIndex = 0;
    }

    setUrls(newUrls);
    setApiUrlIndex(newApiUrlIndex);
    setValidationSuccess(false);
    setValidationError(null);
  };

  // Handle set as API URL
  const handleSetAsApiUrl = (index) => {
    if (index >= 0 && index < urls.length) {
      setApiUrlIndex(index);
      setValidationSuccess(false);
      setValidationError(null);
    }
  };

  // Expose validation function via static property
  // This will be called by the parent wizard component
  useEffect(() => {
    // Create a closure that captures current state
    ProviderDetailsStep.validateCredentials = async () => {
      return await validateCredentials();
    };
    return () => {
      ProviderDetailsStep.validateCredentials = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, apiUrlIndex, username, password, providerType, setIsValidating]);

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter the server URL(s) and authentication credentials for your IPTV provider.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {isXtream ? (
          <>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label="Server URL"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                fullWidth
                placeholder="https://example.com:8080"
                error={!!errors?.urls}
                helperText={errors?.urls || 'Add one or more server URLs'}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
              />
              <IconButton
                onClick={handleAddUrl}
                color="primary"
                disabled={!newUrl.trim()}
                sx={{ minWidth: 56 }}
              >
                <AddIcon />
              </IconButton>
            </Box>

            {urls.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1 }}>
                <InputLabel sx={{ ml: 1, mb: 1 }}>Server URLs</InputLabel>
                <List dense>
                  {urls.map((url, index) => {
                    const isApiUrl = index === apiUrlIndex;
                    return (
                      <ListItem
                        key={index}
                        secondaryAction={
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {!isApiUrl && (
                              <Tooltip title="Set as API URL">
                                <IconButton
                                  edge="end"
                                  size="small"
                                  onClick={() => handleSetAsApiUrl(index)}
                                  color="primary"
                                >
                                  <StarBorderIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => handleRemoveUrl(index)}
                              color="error"
                              title="Remove"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        }
                        sx={{
                          bgcolor: isApiUrl ? 'action.selected' : 'transparent',
                          borderRadius: 1,
                          mb: 0.5,
                        }}
                      >
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {isApiUrl && (
                                <StarIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                              )}
                              <span>{isApiUrl ? `${url} (API)` : url}</span>
                            </Box>
                          }
                          primaryTypographyProps={{
                            variant: 'body2',
                            fontWeight: isApiUrl ? 'bold' : 'normal',
                          }}
                        />
                      </ListItem>
                    );
                  })}
                </List>
              </Paper>
            )}
          </>
        ) : (
          <TextField
            label="URL"
            value={urls[0] || ''}
            onChange={(e) => {
              setUrls([e.target.value]);
              setValidationSuccess(false);
              setValidationError(null);
            }}
            fullWidth
            required
            error={!!errors?.urls}
            helperText={errors?.urls || 'Server URL for AGTV provider'}
          />
        )}

        <TextField
          label="Username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setValidationSuccess(false);
            setValidationError(null);
          }}
          fullWidth
          required
          error={!!errors?.username}
          helperText={errors?.username}
        />

        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setValidationSuccess(false);
            setValidationError(null);
          }}
          fullWidth
          required
          error={!!errors?.password}
          helperText={errors?.password}
        />

        {isValidating && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Validating credentials...
            </Typography>
          </Box>
        )}

        {validationSuccess && !isValidating && (
          <Alert severity="success">
            Credentials validated successfully!
          </Alert>
        )}

        {validationError && !isValidating && (
          <Alert severity="error">
            {validationError}
          </Alert>
        )}

        {errors?.credentials && (
          <Alert severity="error">
            {errors.credentials}
          </Alert>
        )}
      </Box>
    </Box>
  );
}

// Expose validation function (set by useEffect)
ProviderDetailsStep.validateCredentials = null;

export default ProviderDetailsStep;

