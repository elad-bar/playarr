import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DragHandleIcon from '@mui/icons-material/DragHandle';

function ProviderDetailsForm({ provider, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    id: '',
    urls: [],
    username: '',
    password: '',
    type: 'xtream',
    enabled: true,
    priority: 1,
    cleanup: {}
  });
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    if (provider) {
      // Initialize urls from provider.urls or fallback to [provider.url]
      const urls = provider.urls && provider.urls.length > 0
        ? [...provider.urls]
        : (provider.url ? [provider.url] : []);

      setFormData({
        id: provider.id || '',
        urls: urls,
        username: provider.username || '',
        password: provider.password || '',
        type: provider.type || 'xtream',
        enabled: provider.enabled ?? true,
        priority: provider.priority || 1,
        cleanup: provider.cleanup || {}
      });
    } else {
      // New provider - reset form
      setFormData({
        id: '',
        urls: [],
        username: '',
        password: '',
        type: 'xtream',
        enabled: true,
        priority: 1,
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

  const handlePriorityChange = (e) => {
    const value = parseInt(e.target.value) || 999;
    setFormData({
      ...formData,
      priority: value,
    });
  };

  const handleAddUrl = () => {
    if (newUrl.trim()) {
      setFormData({
        ...formData,
        urls: [...formData.urls, newUrl.trim()]
      });
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (index) => {
    const newUrls = formData.urls.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      urls: newUrls
    });
  };

  const handleMoveUrl = (index, direction) => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === formData.urls.length - 1)) {
      return;
    }
    const newUrls = [...formData.urls];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newUrls[index], newUrls[targetIndex]] = [newUrls[targetIndex], newUrls[index]];
    setFormData({
      ...formData,
      urls: newUrls
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // For Xtream: first URL goes to 'url', all URLs go to 'urls'
    // For AGTV: single URL to 'url', urls array limited to 1
    const isXtream = formData.type.toLowerCase() === 'xtream';
    const urls = formData.urls.filter(url => url.trim() !== '');

    const data = {
      id: formData.id,
      urls: isXtream ? urls : (urls.length > 0 ? [urls[0]] : []),
      url: urls.length > 0 ? urls[0] : '',
      username: formData.username,
      password: formData.password,
      type: formData.type.toLowerCase(),
      enabled: formData.enabled,
      priority: formData.priority,
      cleanup: formData.cleanup || {}
    };

    onSave(data);
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
              <InputLabel sx={{ ml: 1, mb: 1 }}>Server URLs (first is used for API calls)</InputLabel>
              <List dense>
                {formData.urls.map((url, index) => (
                  <ListItem
                    key={index}
                    secondaryAction={
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {index > 0 && (
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleMoveUrl(index, 'up')}
                            title="Move up"
                          >
                            <DragHandleIcon sx={{ transform: 'rotate(-90deg)' }} />
                          </IconButton>
                        )}
                        {index < formData.urls.length - 1 && (
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleMoveUrl(index, 'down')}
                            title="Move down"
                          >
                            <DragHandleIcon sx={{ transform: 'rotate(90deg)' }} />
                          </IconButton>
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
                      bgcolor: index === 0 ? 'action.selected' : 'transparent',
                      borderRadius: 1,
                      mb: 0.5
                    }}
                  >
                    <ListItemText
                      primary={index === 0 ? `${url} (API)` : url}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: index === 0 ? 'bold' : 'normal'
                      }}
                    />
                  </ListItem>
                ))}
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
      <TextField
        name="priority"
        label="Priority"
        type="number"
        value={formData.priority}
        onChange={handlePriorityChange}
        fullWidth
        required
        inputProps={{ min: 1 }}
        helperText="Lower number means higher priority (1 is highest)"
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
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button
          onClick={onCancel}
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="primary"
          disabled={
            (isNewProvider && !formData.id) ||
            formData.urls.length === 0 ||
            !formData.username ||
            !formData.password ||
            !formData.type ||
            !formData.priority
          }
        >
          Save Changes
        </Button>
      </Box>
    </Box>
  );
}

export default ProviderDetailsForm;
