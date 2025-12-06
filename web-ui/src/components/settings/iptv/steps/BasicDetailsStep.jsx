import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Typography,
  Alert,
  Chip,
  useTheme,
} from '@mui/material';
import { fetchIPTVProviders, getProviderTypeColor } from '../utils';

/**
 * BasicDetailsStep - Step 1 for add mode only
 * @param {Object} data - Step data { id, type }
 * @param {Function} onChange - Callback when data changes
 * @param {Object} errors - Validation errors { id, type }
 * @param {Function} onValidate - Callback to trigger validation
 */
function BasicDetailsStep({ data, onChange, errors, onValidate }) {
  const theme = useTheme();
  const [providerId, setProviderId] = useState(data?.id || '');
  const providerType = data?.type || 'xtream'; // Type is determined by button clicked, not editable
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
      type: providerType, // Always include the type from data
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

  const getProviderTypeLabel = (type) => {
    const typeMap = {
      xtream: 'Xtream Code',
      agtv: 'Apollo Group TV',
    };
    return typeMap[type] || type;
  };

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Enter a unique identifier for this provider.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Provider Type
          </Typography>
          <Chip 
            label={getProviderTypeLabel(providerType)} 
            variant="outlined"
            sx={{ 
              textTransform: 'capitalize',
              borderColor: getProviderTypeColor(providerType),
              color: getProviderTypeColor(providerType),
            }}
          />
        </Box>

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

