import React from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Tooltip,
  CircularProgress
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

const ProfileUserDetails = ({ profile, setProfile, onSave, saving, isDirty }) => {
  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          User Information
        </Typography>
        <Tooltip title={saving ? 'Saving...' : isDirty ? 'Save changes' : 'No changes to save'}>
          <span>
            <IconButton
              color="primary"
              onClick={onSave}
              disabled={!isDirty || saving}
              sx={{
                bgcolor: (theme) => isDirty && !saving ? theme.palette.primary.main : 'transparent',
                color: (theme) => isDirty && !saving ? theme.palette.primary.contrastText : 'inherit',
                '&:hover': {
                  bgcolor: (theme) => isDirty && !saving ? theme.palette.primary.dark : 'transparent'
                }
              }}
            >
              {saving ? <CircularProgress size={24} /> : <SaveIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <TextField
        fullWidth
        label="Username"
        value={profile.username}
        margin="normal"
        disabled
        helperText="Username cannot be changed"
      />

      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        <TextField
          fullWidth
          label="First Name"
          value={profile.first_name}
          onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
          margin="normal"
        />
        <TextField
          fullWidth
          label="Last Name"
          value={profile.last_name}
          onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
          margin="normal"
        />
      </Box>

      <TextField
        fullWidth
        label="Role"
        value={profile.role || ''}
        margin="normal"
        disabled
        helperText="Role is managed by administrators"
      />
    </Paper>
  );
};

export default ProfileUserDetails;
