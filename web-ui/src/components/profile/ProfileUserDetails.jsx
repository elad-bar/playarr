import React from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
} from '@mui/material';

const ProfileUserDetails = ({ profile, setProfile }) => {
  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          User Information
        </Typography>
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
