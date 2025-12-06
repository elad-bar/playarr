import React from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Tooltip,
  IconButton,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

const ProfilePassword = ({
  passwordForm,
  setPasswordForm,
  showPasswords,
  setShowPasswords,
}) => {
  const togglePasswordVisibility = (field) => {
    setShowPasswords({ ...showPasswords, [field]: !showPasswords[field] });
  };

  return (
    <Paper elevation={3} sx={{ p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          Change Password
        </Typography>
      </Box>

      <TextField
        fullWidth
        label="Current Password"
        type={showPasswords.current ? 'text' : 'password'}
        value={passwordForm.current_password}
        onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
        margin="normal"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={showPasswords.current ? 'Hide password' : 'Show password'}>
                <IconButton
                  onClick={() => togglePasswordVisibility('current')}
                  edge="end"
                  aria-label="toggle current password visibility"
                >
                  {showPasswords.current ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          )
        }}
      />

      <TextField
        fullWidth
        label="New Password"
        type={showPasswords.new ? 'text' : 'password'}
        value={passwordForm.new_password}
        onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
        margin="normal"
        helperText="Must be at least 8 characters long"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={showPasswords.new ? 'Hide password' : 'Show password'}>
                <IconButton
                  onClick={() => togglePasswordVisibility('new')}
                  edge="end"
                  aria-label="toggle new password visibility"
                >
                  {showPasswords.new ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          )
        }}
      />

      <TextField
        fullWidth
        label="Confirm New Password"
        type={showPasswords.confirm ? 'text' : 'password'}
        value={passwordForm.confirm_password}
        onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
        margin="normal"
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={showPasswords.confirm ? 'Hide password' : 'Show password'}>
                <IconButton
                  onClick={() => togglePasswordVisibility('confirm')}
                  edge="end"
                  aria-label="toggle confirm password visibility"
                >
                  {showPasswords.confirm ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          )
        }}
      />
    </Paper>
  );
};

export default ProfilePassword;
