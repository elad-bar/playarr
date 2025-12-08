import React, { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  TextField,
  IconButton,
} from '@mui/material';
import { DeleteOutlined as DeleteIcon } from '@mui/icons-material';

function CleanupRulesForm({ provider, onSave, onCancel }) {
  const [rules, setRules] = useState(provider.cleanup || {});
  const [newPattern, setNewPattern] = useState('');
  const [newReplacement, setNewReplacement] = useState('');

  const handleSave = useCallback(() => {
    onSave({
      ...provider,
      cleanup: rules
    });
  }, [rules, provider, onSave]);

  // Expose save handler
  useEffect(() => {
    CleanupRulesForm.saveHandler = handleSave;
    return () => {
      CleanupRulesForm.saveHandler = null;
    };
  }, [handleSave]);

  const handleAddRule = () => {
    if (newPattern && newReplacement) {
      setRules({
        ...rules,
        [newPattern]: newReplacement
      });
      setNewPattern('');
      setNewReplacement('');
    }
  };

  const handleRemoveRule = (pattern) => {
    const newRules = { ...rules };
    delete newRules[pattern];
    setRules(newRules);
  };

  const handleUpdateRule = (oldPattern, field, value) => {
    const newRules = { ...rules };
    if (field === 'pattern') {
      // If pattern is being updated, we need to create a new key
      const replacement = newRules[oldPattern];
      delete newRules[oldPattern];
      newRules[value] = replacement;
    } else {
      // If replacement is being updated, just update the value
      newRules[oldPattern] = value;
    }
    setRules(newRules);
  };

  return (
    <Box>
      {/* Existing Rules */}
      {Object.entries(rules).map(([pattern, replacement]) => (
        <Card key={pattern} sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              label="Pattern"
              value={pattern}
              onChange={(e) => handleUpdateRule(pattern, 'pattern', e.target.value)}
              fullWidth
            />
            <TextField
              label="Replacement"
              value={replacement}
              onChange={(e) => handleUpdateRule(pattern, 'replacement', e.target.value)}
              fullWidth
            />
            <IconButton
              onClick={() => handleRemoveRule(pattern)}
              color="error"
              size="small"
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        </Card>
      ))}

      {/* Add New Rule */}
      <Card sx={{ p: 2, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            label="Pattern"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            fullWidth
            placeholder="Enter pattern to match"
          />
          <TextField
            label="Replacement"
            value={newReplacement}
            onChange={(e) => setNewReplacement(e.target.value)}
            fullWidth
            placeholder="Enter replacement text"
          />
          <Button
            variant="contained"
            onClick={handleAddRule}
            disabled={!newPattern || !newReplacement}
          >
            Add
          </Button>
        </Box>
      </Card>

    </Box>
  );
}

// Expose save handler via ref
CleanupRulesForm.saveHandler = null;

export default CleanupRulesForm;
