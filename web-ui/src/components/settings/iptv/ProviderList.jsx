import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Alert,
  Grid,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import { getProviderTypeColor } from './utils';

/**
 * Provider grid component with up to 4 cards per row
 * First card is "Add New", rest are provider cards
 */
function ProviderList({
  providers,
  selectedProvider,
  isNewProvider,
  error,
  onAdd,
  onEdit,
  onDelete,
  onCloseDialog
}) {
  const theme = useTheme();
  const isXSmall = useMediaQuery(theme.breakpoints.down('sm'));
  const isSmall = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const isMedium = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const isLarge = useMediaQuery(theme.breakpoints.up('lg'));

  // Calculate grid columns: up to 4 cards per row
  const getGridColumns = () => {
    if (isXSmall) return 1;
    if (isSmall) return 2;
    if (isMedium) return 3;
    if (isLarge) return 4;
    return 4;
  };

  const gridColumns = getGridColumns();

  return (
    <Box sx={{ p: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Add New Card - Always first */}
        <Grid item xs={12} sm={6} md={4} lg={3} sx={{ 
          maxWidth: isXSmall ? '100%' : isSmall ? '50%' : isMedium ? '33.333%' : '25%'
        }}>
          <Card
            sx={{
              height: '100%',
              cursor: 'pointer',
              border: '2px dashed',
              borderColor: 'primary.main',
              backgroundColor: 'action.hover',
              '&:hover': {
                backgroundColor: 'action.selected',
                borderColor: 'primary.dark',
              },
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 120
            }}
            onClick={() => {
              if (isNewProvider) {
                onCloseDialog();
              }
              onAdd();
            }}
          >
            <CardContent sx={{ textAlign: 'center', p: 2 }}>
              <AddIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
              <Typography variant="h6" color="primary">
                Add New Provider
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Provider Cards */}
        {providers.map((provider) => (
          <Grid 
            key={provider.id} 
            item 
            xs={12} 
            sm={6} 
            md={4} 
            lg={3}
            sx={{ 
              maxWidth: isXSmall ? '100%' : isSmall ? '50%' : isMedium ? '33.333%' : '25%'
            }}
          >
            <Card
              sx={{
                height: '100%',
                cursor: 'pointer',
                border: selectedProvider?.id === provider.id ? '2px solid' : '1px solid',
                borderColor: selectedProvider?.id === provider.id ? 'primary.main' : 'divider',
                backgroundColor: selectedProvider?.id === provider.id ? 'action.selected' : 'background.paper',
                borderBottom: `2px ${provider.enabled ? 'solid' : 'dashed'} ${getProviderTypeColor(provider.type)}`,
                '&:hover': {
                  backgroundColor: 'action.hover',
                  borderColor: 'primary.main',
                },
                position: 'relative',
                minHeight: 120
              }}
              onClick={() => {
                if (isNewProvider) {
                  onCloseDialog();
                }
                onEdit(provider);
              }}
            >
              <CardContent sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', flex: 1 }}>
                    {provider.id}
                  </Typography>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(provider.id);
                    }}
                    sx={{ ml: 1 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {providers.length === 0 && (
        <Box sx={{ textAlign: 'center', mt: 4, p: 3 }}>
          <Typography color="textSecondary">
            No providers found. Click "Add New Provider" to add one.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default ProviderList;
