import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import IgnoredTitlesForm from './IgnoredTitlesForm';

/**
 * IgnoredTitlesDialog - Dialog for displaying ignored titles
 * @param {boolean} open - Whether dialog is open
 * @param {Object} provider - Provider object
 * @param {Function} onClose - Callback when dialog is closed
 */
function IgnoredTitlesDialog({ open, provider, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" component="span">
          Ignored Titles: {provider?.id}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <IgnoredTitlesForm provider={provider} />
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default IgnoredTitlesDialog;

