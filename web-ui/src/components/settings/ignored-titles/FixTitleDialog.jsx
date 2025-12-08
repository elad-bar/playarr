import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardMedia,
  Tooltip
} from '@mui/material';
import {
  CloseOutlined as CloseIcon,
  CheckCircleOutlined as CheckCircleIcon,
  SearchOutlined as SearchIcon
} from '@mui/icons-material';
import IconButton from '@mui/material/IconButton';
import { ignoredTitlesService } from '../../../services/ignoredTitles';
import { getMediaTypeColors, getMediaTypeLabel } from '../../settings/iptv/utils';
import { useTheme } from '@mui/material/styles';

// Base64 encoded placeholder image
const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const sanitizeImageUrl = (url) => {
  if (!url) return PLACEHOLDER_IMAGE;
  const cleanUrl = url.split('https://').pop();
  return cleanUrl ? `https://${cleanUrl}` : PLACEHOLDER_IMAGE;
};

const FixTitleDialog = ({ open, onClose, title, onFixed }) => {
  const theme = useTheme();
  const [tmdbId, setTmdbId] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const mediaTypeColors = getMediaTypeColors(title?.type || 'movies', theme);
  const tmdbType = title?.type === 'movies' ? 'movie' : 'tv';

  const handleValidate = async () => {
    if (!tmdbId || isNaN(parseInt(tmdbId))) {
      setError('Please enter a valid TMDB ID');
      setValidationResult(null);
      return;
    }

    setValidating(true);
    setError(null);
    setValidationResult(null);

    try {
      const result = await ignoredTitlesService.validateTMDBId(title._id, tmdbType, parseInt(tmdbId));
      setValidationResult(result);
      if (!result.valid) {
        setError(result.error || 'TMDB ID not found');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to validate TMDB ID');
      setValidationResult({ valid: false });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!validationResult || !validationResult.valid) {
      setError('Please validate the TMDB ID first');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await ignoredTitlesService.updateProviderTitle(title._id, parseInt(tmdbId), tmdbType);
      setSuccess(true);
      setTimeout(() => {
        onFixed();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update provider title');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving && !success) {
      setTmdbId('');
      setValidationResult(null);
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '400px'
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="div">
            Fix Ignored Title
          </Typography>
          <IconButton
            onClick={handleClose}
            disabled={saving || success}
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {success ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CheckCircleIcon sx={{ fontSize: '4rem', color: 'success.main', mb: 2 }} />
            <Typography variant="h6" color="success.main" gutterBottom>
              Title Fixed Successfully!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The title has been updated and will be included in the next sync.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {/* Left Column - Title Info */}
            <Grid item xs={12} md={5}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                Provider Title Details
              </Typography>
              
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Title
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                    {title?.title || 'Untitled'}
                  </Typography>
                  <Tooltip title="Search on TMDB">
                    <IconButton
                      size="small"
                      onClick={() => {
                        const searchQuery = encodeURIComponent(title?.title || '');
                        window.open(`https://www.themoviedb.org/search?query=${searchQuery}`, '_blank', 'noopener,noreferrer');
                      }}
                      sx={{ 
                        color: 'primary.main',
                        '&:hover': {
                          backgroundColor: 'action.hover'
                        }
                      }}
                    >
                      <SearchIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Provider
                </Typography>
                <Typography variant="body1">
                  {title?.provider_name || title?.provider_id}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Media Type
                </Typography>
                <Chip
                  label={getMediaTypeLabel(title?.type)}
                  size="small"
                  sx={{
                    backgroundColor: mediaTypeColors.main,
                    color: mediaTypeColors.contrastText
                  }}
                />
              </Box>

              {title?.year && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Year
                  </Typography>
                  <Typography variant="body1">
                    {title.year}
                  </Typography>
                </Box>
              )}

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Issue
                </Typography>
                <Typography variant="body1" color="error">
                  {title?.ignored_reason || 'Unknown issue'}
                </Typography>
              </Box>
            </Grid>

            {/* Right Column - TMDB ID Input and Validation */}
            <Grid item xs={12} md={7}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                Assign TMDB ID
              </Typography>

              <Box sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  label="TMDB ID"
                  type="number"
                  value={tmdbId}
                  onChange={(e) => {
                    setTmdbId(e.target.value);
                    setValidationResult(null);
                    setError(null);
                  }}
                  placeholder="Enter TMDB ID"
                  disabled={saving}
                  InputProps={{
                    endAdornment: (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={handleValidate}
                        disabled={!tmdbId || validating || saving}
                        sx={{ ml: 1 }}
                      >
                        {validating ? <CircularProgress size={20} /> : 'Validate'}
                      </Button>
                    )
                  }}
                />
              </Box>

              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              {validationResult && validationResult.valid && validationResult.preview && (
                <Card sx={{ mb: 2, bgcolor: 'success.light' }}>
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CheckCircleIcon color="success" />
                      TMDB ID Valid
                    </Typography>
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      {validationResult.preview.poster_path && (
                        <Grid item xs={4}>
                          <CardMedia
                            component="img"
                            image={sanitizeImageUrl(`https://image.tmdb.org/t/p/w300${validationResult.preview.poster_path}`)}
                            alt={validationResult.preview.title}
                            sx={{
                              borderRadius: 1,
                              objectFit: 'cover',
                              width: '100%'
                            }}
                            onError={(e) => {
                              e.target.src = PLACEHOLDER_IMAGE;
                            }}
                          />
                        </Grid>
                      )}
                      <Grid item xs={validationResult.preview.poster_path ? 8 : 12}>
                        <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                          {validationResult.preview.title}
                        </Typography>
                        {validationResult.preview.release_date && (
                          <Typography variant="body2" color="text.secondary">
                            {new Date(validationResult.preview.release_date).getFullYear()}
                          </Typography>
                        )}
                        {validationResult.preview.overview && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {validationResult.preview.overview.substring(0, 150)}...
                          </Typography>
                        )}
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              )}
            </Grid>
          </Grid>
        )}
      </DialogContent>

      {!success && (
        <DialogActions>
          <Button onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={!validationResult || !validationResult.valid || saving}
            startIcon={saving ? <CircularProgress size={20} /> : null}
          >
            {saving ? 'Saving...' : 'Save & Unignore'}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export default FixTitleDialog;

