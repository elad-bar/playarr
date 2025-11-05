import React from 'react';
import {
  Box,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Alert,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, DragIndicator as DragIcon } from '@mui/icons-material';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

function ProviderList({
  providers,
  selectedProvider,
  isNewProvider,
  error,
  onAdd,
  onEdit,
  onDelete,
  onDragEnd,
  onCloseDialog
}) {
  return (
    <Box sx={{ width: 300, borderRight: 1, borderColor: 'divider', p: 2, overflow: 'auto' }}>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Providers</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={onAdd}
        >
          Add
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {providers.length === 0 ? (
        <Typography color="textSecondary" sx={{ textAlign: 'center', mt: 2 }}>
          No providers found. Click the "Add" button to add one.
        </Typography>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="providers">
            {(provided) => (
              <List
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {providers.map((provider, index) => (
                  <Draggable
                    key={provider.id}
                    draggableId={provider.id}
                    index={index}
                  >
                    {(provided, snapshot) => (
                      <ListItem
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        button
                        selected={selectedProvider?.id === provider.id}
                        onClick={() => {
                          if (isNewProvider) {
                            onCloseDialog();
                          }
                          onEdit(provider);
                        }}
                        sx={{
                          mb: 1,
                          ...snapshot.isDragging ? {
                            background: 'rgba(0, 0, 0, 0.1)',
                            boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)'
                          } : {}
                        }}
                      >
                        <Box {...provided.dragHandleProps} sx={{ mr: 1, cursor: 'grab' }}>
                          <DragIcon />
                        </Box>
                        <ListItemText
                          primary={provider.id}
                        />
                        <ListItemSecondaryAction>
                          <IconButton onClick={() => onDelete(provider.id)} size="small" color="error">
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </List>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </Box>
  );
}

export default ProviderList;
