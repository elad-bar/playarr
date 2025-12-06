import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';

function ProviderDetailsForm({ provider, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    urls: [],
    apiUrlIndex: 0,
    username: '',
    password: '',
    type: 'xtream',
    enabled: true,
    cleanup: {}
  });
  const [newUrl, setNewUrl] = useState('');

  const handleSubmit = useCallback((e) => {
    if (e) e.preventDefault();

    // For Xtream: selected URL goes to api_url, all URLs go to streams_urls
    // For AGTV: single URL to api_url, streams_urls array limited to 1
    const isXtream = formData.type.toLowerCase() === 'xtream';
    const urls = formData.urls.filter(url => url.trim() !== '');
    
    // Ensure apiUrlIndex is valid
    let apiUrlIndex = 0;
    if (urls.length > 0) {
      apiUrlIndex = Math.max(0, Math.min(formData.apiUrlIndex, urls.length - 1));
    }

    const data = {
      id: formData.id,
      streams_urls: isXtream ? urls : (urls.length > 0 ? [urls[0]] : []),
      api_url: urls.length > 0 ? urls[apiUrlIndex] : '',
      username: formData.username,
      password: formData.password,
      type: formData.type.toLowerCase(),
      enabled: formData.enabled,
      cleanup: formData.cleanup || {}
    };

    onSave(data);
  }, [formData, onSave]);

  // Expose save handler
  useEffect(() => {
    ProviderDetailsForm.saveHandler = handleSubmit;
    return () => {
      ProviderDetailsForm.saveHandler = null;
    };
  }, [handleSubmit]);

  useEffect(() => {
    if (provider) {
      // Initialize urls from provider.streams_urls
      const urls = provider.streams_urls || [];
      
      // Find which URL matches the api_url to set as API URL
      // If api_url is missing or doesn't match any URL, default to first URL (index 0)
      let apiUrlIndex = 0;
      if (provider.api_url && urls.length > 0) {
        const apiUrlIndexFound = urls.findIndex(url => url === provider.api_url);
        if (apiUrlIndexFound >= 0) {
          apiUrlIndex = apiUrlIndexFound;
        } else {
          // api_url doesn't match any URL, default to first
          apiUrlIndex = 0;
        }
      } else if (urls.length > 0) {
        // No api_url provided, default to first URL
        apiUrlIndex = 0;
      }

      setFormData({
        id: provider.id || '',
        urls: urls,
        apiUrlIndex: apiUrlIndex,
        username: provider.username || '',
        password: provider.password || '',
        type: provider.type || 'xtream',
        enabled: provider.enabled ?? true,
        cleanup: provider.cleanup || {}
      });
    } else {
      // New provider - reset form
      setFormData({
        id: '',
        urls: [],
        apiUrlIndex: 0,
        username: '',
        password: '',
        type: 'xtream',
        enabled: true,
        cleanup: {}
      });
      setNewUrl('');
    }
  }, [provider]);

  const handleChange = (e) => {
    const value = e.target.name === 'type' ? e.target.value.toLowerCase() : e.target.value;
    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  const handleToggleEnabled = (e) => {
    setFormData({
      ...formData,
      enabled: e.target.checked,
    });
  };

  const handleAddUrl = () => {
    if (newUrl.trim()) {
      const newUrls = [...formData.urls, newUrl.trim()];
      // If this is the first URL, automatically set it as API URL
      const newApiUrlIndex = formData.urls.length === 0 ? 0 : formData.apiUrlIndex;
      setFormData({
        ...formData,
        urls: newUrls,
        apiUrlIndex: newApiUrlIndex
      });
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (index) => {
    const newUrls = formData.urls.filter((_, i) => i !== index);
    let newApiUrlIndex = formData.apiUrlIndex;
    
    // Adjust apiUrlIndex if the removed URL was before it or was the API URL
    if (index < formData.apiUrlIndex) {
      newApiUrlIndex = formData.apiUrlIndex - 1;
    } else if (index === formData.apiUrlIndex) {
      // If we removed the API URL, set the first URL as API (or 0 if empty)
      newApiUrlIndex = 0;
    }
    
    // Ensure apiUrlIndex is valid
    if (newApiUrlIndex >= newUrls.length && newUrls.length > 0) {
      newApiUrlIndex = newUrls.length - 1;
    } else if (newUrls.length === 0) {
      newApiUrlIndex = 0;
    }
    
    setFormData({
      ...formData,
      urls: newUrls,
      apiUrlIndex: newApiUrlIndex
    });
  };

  const handleSetAsApiUrl = (index) => {
    if (index >= 0 && index < formData.urls.length) {
      setFormData(prev => ({
        ...prev,
        apiUrlIndex: index
      }));
    }
  };

  const isXtream = formData.type?.toLowerCase() === 'xtream';
  const isNewProvider = !provider?.id;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {isNewProvider && (
        <TextField
          name="id"
          label="Provider ID"
          value={formData.id}
          onChange={handleChange}
          fullWidth
          required
          helperText="Unique identifier for this provider (required)"
        />
      )}
      <FormControl fullWidth required>
        <InputLabel>Type</InputLabel>
        <Select
          name="type"
          value={formData.type.toLowerCase()}
          onChange={handleChange}
          label="Type"
          disabled={!isNewProvider}
        >
          <MenuItem value="agtv">AGTV</MenuItem>
          <MenuItem value="xtream">Xtream</MenuItem>
        </Select>
      </FormControl>

      {isXtream ? (
        <>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              label="Server URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              fullWidth
              placeholder="https://example.com:8080"
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

          {formData.urls.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1 }}>
              <InputLabel sx={{ ml: 1, mb: 1 }}>Server URLs</InputLabel>
              <List dense>
                {formData.urls.map((url, index) => {
                  const isApiUrl = index === formData.apiUrlIndex;
                  return (
                    <ListItem
                      key={index}
                      secondaryAction={
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {!isApiUrl && (
                            <Tooltip title="Set as API Url">
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
                        mb: 0.5
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
                          fontWeight: isApiUrl ? 'bold' : 'normal'
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
          name="url"
          label="URL"
          value={formData.urls[0] || ''}
          onChange={(e) => {
            setFormData({
              ...formData,
              urls: [e.target.value]
            });
          }}
          fullWidth
          required
        />
      )}
      <TextField
        name="username"
        label="Username"
        value={formData.username}
        onChange={handleChange}
        fullWidth
        required
      />
      <TextField
        name="password"
        label="Password"
        type="password"
        value={formData.password}
        onChange={handleChange}
        fullWidth
        required
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={formData.enabled}
            onChange={handleToggleEnabled}
            name="enabled"
          />
        }
        label="Enabled"
      />
    </Box>
  );
}

// Expose save handler via static property
ProviderDetailsForm.saveHandler = null;

export default ProviderDetailsForm;
