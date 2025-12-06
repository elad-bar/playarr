import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import CleanupRulesForm from '../CleanupRulesForm';

/**
 * CleanupRulesStep - Step 3 (add) / Step 2 (edit), Xtream only
 * @param {Object} provider - Provider object
 * @param {Object} data - Step data { cleanup }
 * @param {Function} onChange - Callback when data changes
 * @param {Function} onSave - Callback when data is saved
 */
function CleanupRulesStep({ provider, data, onChange, onSave }) {
  const [cleanup, setCleanup] = useState(data?.cleanup || provider?.cleanup || {});

  // Update parent when cleanup changes
  useEffect(() => {
    onChange({
      cleanup,
    });
  }, [cleanup, onChange]);

  // Handle save from CleanupRulesForm
  const handleSave = (providerData) => {
    const newCleanup = providerData.cleanup || {};
    setCleanup(newCleanup);
    onChange({ cleanup: newCleanup });
    if (onSave) {
      onSave({ cleanup: newCleanup });
    }
  };

  // Create a provider object for CleanupRulesForm
  const formProvider = {
    ...provider,
    cleanup,
  };

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Define pattern/replacement rules to clean up title names from your provider.
      </Typography>
      <CleanupRulesForm
        provider={formProvider}
        onSave={handleSave}
        onCancel={() => {}}
      />
    </Box>
  );
}

export default CleanupRulesStep;

