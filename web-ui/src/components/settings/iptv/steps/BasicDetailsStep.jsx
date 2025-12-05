import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Alert,
} from '@mui/material';
import { fetchIPTVProviders } from '../utils';

/**
 * BasicDetailsStep - Step 1 for add mode only
 * @param {Object} data - Step data { id, type }
 * @param {Function} onChange - Callback when data changes
 * @param {Object} errors - Validation errors { id, type }
 * @param {Function} onValidate - Callback to trigger validation
 */
function BasicDetailsStep({ data, onChange, errors, onValidate }) {
  const [providerId, setProviderId] = useState(data?.id || '');
  const [providerType, setProviderType] = useState(data?.type || 'xtream');
  const [existingProviders, setExistingProviders] = useState([]);
  const [idError, setIdError] = useState(null);

  // Load existing providers to check uniqueness
  useEffect(() => {
    fetchIPTVProviders()
      .then(providers => setExistingProviders(providers))
      .catch(error => console.error('Error fetching providers:', error));
  }, []);

  // Validate ID format
  const validateIdFormat = (id) => {
    if (!id || id.trim() === '') {
      return 'Provider ID is required';
    }
    // Alphanumeric, hyphens, underscores only
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
    
    // Validate format
    const formatError = validateIdFormat(newId);
    if (formatError) {
      setIdError(formatError);
    } else {
      // Check uniqueness
      const uniquenessError = checkIdUniqueness(newId);
      setIdError(uniquenessError);
    }

    // Update parent
    onChange({
      ...data,
      id: newId,
    });
  };

  // Handle type change
  const handleTypeChange = (event) => {
    const newType = event.target.value;
    setProviderType(newType);
    
    // Update parent
    onChange({
      ...data,
      type: newType,
    });
  };

  // Update parent when component mounts or data changes
  useEffect(() => {
    onChange({
      id: providerId,
      type: providerType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter a unique identifier and select the provider type.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextField
          label="Provider ID"
          value={providerId}
          onChange={handleIdChange}
          error={!!(errors?.id || idError)}
          helperText={errors?.id || idError || 'Unique identifier for this provider (letters, numbers, hyphens, underscores only)'}
          required
          fullWidth
          autoFocus
        />

        <FormControl fullWidth required error={!!errors?.type}>
          <InputLabel>Provider Type</InputLabel>
          <Select
            value={providerType}
            onChange={handleTypeChange}
            label="Provider Type"
          >
            <MenuItem value="xtream">Xtream</MenuItem>
            <MenuItem value="agtv">AGTV</MenuItem>
          </Select>
          {errors?.type && (
            <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
              {errors.type}
            </Typography>
          )}
        </FormControl>

        {providerType === 'agtv' && (
          <Alert severity="info">
            AGTV providers have a simplified setup process. Cleanup Rules and Categories steps will be skipped.
          </Alert>
        )}
      </Box>
    </Box>
  );
}

export default BasicDetailsStep;

