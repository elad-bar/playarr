import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
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
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { validateIPTVProviderCredentials, saveIPTVProvider, fetchIPTVProviders } from './utils';

/**
 * ProviderEditorDialog - Simplified provider editor with only provider details
 * @param {boolean} open - Whether dialog is open
 * @param {Object|null} provider - Provider object (null for add mode)
 * @param {Function} onClose - Callback when dialog is closed
 * @param {Function} onSave - Callback when provider is saved
 * @param {Function} onSaveAndManageMediaTypes - Callback when provider is saved and should open media type dialog
 */
function ProviderEditorDialog({
  open,
  provider,
  onClose,
  onSave,
  onSaveAndManageMediaTypes,
}) {
  const isAddMode = !provider || !provider.id;
  const providerType = provider?.type?.toLowerCase() || 'xtream';
  const isXtream = providerType === 'xtream';

  // State
  const [providerId, setProviderId] = useState(provider?.id || '');
  const [urls, setUrls] = useState(provider?.streams_urls || []);
  const [apiUrlIndex, setApiUrlIndex] = useState(
    provider?.api_url && provider?.streams_urls
      ? provider.streams_urls.findIndex(url => url === provider.api_url)
      : 0
  );
  const [username, setUsername] = useState(provider?.username || '');
  const [password, setPassword] = useState(provider?.password || '');
  const [newUrl, setNewUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState(null);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [idError, setIdError] = useState(null);
  const [existingProviders, setExistingProviders] = useState([]);

  // Load existing providers for ID uniqueness check
  useEffect(() => {
    if (open && isAddMode) {
      fetchIPTVProviders()
        .then(providers => setExistingProviders(providers))
        .catch(error => console.error('Error fetching providers:', error));
    }
  }, [open, isAddMode]);

  // Reset state when dialog opens/closes or provider changes
  useEffect(() => {
    if (open) {
      if (isAddMode) {
        setProviderId('');
        setUrls([]);
        setApiUrlIndex(0);
        setUsername('');
        setPassword('');
        setNewUrl('');
      } else {
        setProviderId(provider.id);
        setUrls(provider.streams_urls || []);
        setApiUrlIndex(
          provider.api_url && provider.streams_urls
            ? provider.streams_urls.findIndex(url => url === provider.api_url)
            : 0
        );
        setUsername(provider.username || '');
        setPassword(provider.password || '');
        setNewUrl('');
      }
      setValidationError(null);
      setValidationSuccess(false);
      setErrors({});
      setIdError(null);
    }
  }, [open, provider, isAddMode]);

  // Validate ID format
  const validateIdFormat = (id) => {
    if (!id || id.trim() === '') {
      return 'Provider ID is required';
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return 'Provider ID can only contain letters, numbers, hyphens, and underscores';
    }
    return null;
  };

  // Check ID uniqueness
  const checkIdUniqueness = (id) => {
    if (!id || id.trim() === '') {
      return 'Provider ID is required';
    }
    const normalizedId = id.trim().toLowerCase();
    const exists = existingProviders.some(
      p => p.id?.toLowerCase() === normalizedId
    );
    if (exists) {
      return 'Provider ID already exists';
    }
    return null;
  };

  // Handle ID change
  const handleIdChange = (event) => {
    const newId = event.target.value;
    setProviderId(newId);
    const formatError = validateIdFormat(newId);
    if (formatError) {
      setIdError(formatError);
    } else {
      const uniquenessError = checkIdUniqueness(newId);
      setIdError(uniquenessError);
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

  // Handle save
  const handleSave = async (openMediaTypes = false) => {
    // Validate basic fields
    const newErrors = {};
    
    if (isAddMode) {
      const formatError = validateIdFormat(providerId);
      if (formatError) {
        newErrors.id = formatError;
        setIdError(formatError);
      } else {
        const uniquenessError = checkIdUniqueness(providerId);
        if (uniquenessError) {
          newErrors.id = uniquenessError;
          setIdError(uniquenessError);
        }
      }
    }

    if (urls.length === 0) {
      newErrors.urls = 'At least one URL is required';
    }

    if (!username.trim()) {
      newErrors.username = 'Username is required';
    }

    if (!password.trim()) {
      newErrors.password = 'Password is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSaving(true);
    setErrors({});
    setValidationError(null);
    setValidationSuccess(false);

    try {
      const apiUrl = urls[apiUrlIndex] || urls[0];
      
      // Validate credentials before saving
      setIsValidating(true);
      const validationResult = await validateIPTVProviderCredentials(
        apiUrl,
        username.trim(),
        password.trim(),
        providerType
      );

      setIsValidating(false);

      if (!validationResult.success || !validationResult.valid) {
        // Validation failed - do not save, show error
        const errorMessage = validationResult.error || 'Invalid credentials';
        setValidationError(errorMessage);
        setErrors({ general: `Credential validation failed: ${errorMessage}. Provider not saved.` });
        setIsSaving(false);
        return;
      }

      // Validation passed - proceed with save
      setValidationSuccess(true);
      setValidationError(null);

      const providerData = {
        id: isAddMode ? providerId : provider.id,
        type: providerType,
        streams_urls: urls,
        api_url: apiUrl,
        username: username.trim(),
        password: password.trim(),
      };

      const savedProvider = await saveIPTVProvider(providerData, isAddMode);

      if (openMediaTypes) {
        onSaveAndManageMediaTypes(savedProvider);
      } else {
        onSave(savedProvider);
      }
    } catch (error) {
      setIsValidating(false);
      setErrors({ general: error.message || 'Failed to save provider' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="span">
          {isAddMode ? 'Add New Provider' : `Edit Provider: ${provider?.id}`}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {isAddMode && (
            <TextField
              label="Provider ID"
              value={providerId}
              onChange={handleIdChange}
              fullWidth
              required
              error={!!idError || !!errors.id}
              helperText={idError || errors.id || 'Alphanumeric, hyphens, and underscores only'}
            />
          )}

          {isXtream ? (
            <>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  label="Server URL"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  fullWidth
                  placeholder="https://example.com:8080"
                  error={!!errors.urls}
                  helperText={errors.urls || 'Add one or more server URLs'}
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
                              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {isApiUrl && (
                                  <StarIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                                )}
                                <span>{isApiUrl ? `${url} (API)` : url}</span>
                              </Box>
                            }
                            primaryTypographyProps={{
                              variant: 'body2',
                              fontWeight: isApiUrl ? 'bold' : 'normal',
                              component: 'span',
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
              error={!!errors.urls}
              helperText={errors.urls || 'Server URL for AGTV provider'}
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
            error={!!errors.username}
            helperText={errors.username}
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
            error={!!errors.password}
            helperText={errors.password}
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

          {errors.general && (
            <Alert severity="error">
              {errors.general}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={() => handleSave(false)}
          variant="contained"
          disabled={isSaving}
        >
          {isSaving ? <CircularProgress size={20} /> : 'Save'}
        </Button>
        {isAddMode && (
          <Button
            onClick={() => handleSave(true)}
            variant="contained"
            disabled={isSaving}
          >
            {isSaving ? <CircularProgress size={20} /> : 'Save and Manage Media Types'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ProviderEditorDialog;

