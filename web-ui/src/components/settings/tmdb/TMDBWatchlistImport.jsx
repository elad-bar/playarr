import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box,
    TextField,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    CircularProgress,
    Alert,
    List,
    ListItem,
    ListItemIcon,
    Checkbox,
    ListItemText,
    Paper,
    ButtonGroup,
    Stepper,
    Step,
    StepLabel,
    InputAdornment,
    IconButton,
    Chip
} from '@mui/material';
import {
    Movie as MovieIcon,
    Tv as TvIcon,
    PlaylistAdd as PlaylistAddIcon,
    SelectAll as SelectAllIcon,
    Clear as ClearIcon,
    NavigateNext as NextIcon,
    NavigateBefore as BackIcon,
    ContentCopy as ContentCopyIcon,
    Visibility as VisibilityIcon,
    VisibilityOff as VisibilityOffIcon
} from '@mui/icons-material';
import {
    fetchTMDBLists,
    fetchTMDBListItems,
    setSelectedList,
    setSelectedItems,
    clearTMDBError,
    clearTMDBSuccess,
    updateListItemsWatchlistStatus
} from '../../../store/slices/settingsSlice';
import { updateWatchlistBulk } from '../../../store/slices/titlesSlice';

const STEPS = ['Enter API Key', 'Select List', 'Choose Titles'];

const TMDBWatchlistImport = () => {
    const dispatch = useDispatch();
    const {
        lists,
        selectedList,
        listItems,
        selectedItems,
        loading,
        error,
        success
    } = useSelector(state => state.settings.tmdb);
    const [activeStep, setActiveStep] = useState(0);
    const [showApiKey, setShowApiKey] = useState(false);
    const [localApiKey, setLocalApiKey] = useState('');

    const handleCopyFromSettings = async () => {
        try {
            const result = await dispatch(fetchTMDBLists(localApiKey)).unwrap();
            if (result.lists && result.lists.length > 0) {
                dispatch(setSelectedList(''));
                setActiveStep(1);
            } else {
                throw new Error('No lists available');
            }
        } catch (error) {
            console.error('Failed to fetch API key:', error);
        }
    };

    const handleNext = async () => {
        try {
            if (activeStep === 0) {
                const result = await dispatch(fetchTMDBLists(localApiKey)).unwrap();
                if (result.lists && result.lists.length > 0) {
                    dispatch(setSelectedList(''));
                    setActiveStep(1);
                } else {
                    throw new Error('No lists available');
                }
            } else if (activeStep === 1) {
                try {
                    await dispatch(fetchTMDBListItems({ apiKey: localApiKey, listId: selectedList })).unwrap();
                    setActiveStep(2);
                    dispatch(setSelectedItems([]));
                } catch (err) {
                    console.error('Failed to fetch list items:', err);
                }
            }
        } catch (err) {
            console.error('Error in handleNext:', err);
        }
    };

    const handleBack = () => {
        setActiveStep((prevStep) => prevStep - 1);
    };

    const handleListSelect = (event) => {
        dispatch(setSelectedList(event.target.value));
    };

    const handleItemToggle = (titleKey) => {
        const currentIndex = selectedItems.indexOf(titleKey);
        const newSelectedItems = [...selectedItems];

        if (currentIndex === -1) {
            newSelectedItems.push(titleKey);
        } else {
            newSelectedItems.splice(currentIndex, 1);
        }

        dispatch(setSelectedItems(newSelectedItems));
    };

    const handleSelectAll = () => {
        const selectableItems = listItems
            .filter(item => !item.in_watchlist && item.exists)
            .map(item => item.id);
        dispatch(setSelectedItems(selectableItems));
    };

    const handleClearSelection = () => {
        dispatch(setSelectedItems([]));
    };

    const handleAddToWatchlist = async () => {
        try {
            const titles = selectedItems.map(id => {
                const item = listItems.find(item => item.id === id);
                return {
                    key: `${item.media_type === 'movie' ? 'movies' : 'shows'}-${id}`,
                    watchlist: true
                };
            });
            await dispatch(updateWatchlistBulk({ titles })).unwrap();
            dispatch(updateListItemsWatchlistStatus(titles));
            dispatch(setSelectedItems([]));
        } catch (err) {
            // Error handling is managed by Redux
        }
    };

    const handleCloseAlert = () => {
        if (error) dispatch(clearTMDBError());
        if (success) dispatch(clearTMDBSuccess());
    };

    const getSelectableItemCount = () => {
        return listItems.length;
    };

    const renderListSelection = () => (
        <FormControl fullWidth error={!!error}>
            <InputLabel>Select TMDB List</InputLabel>
            <Select
                value={selectedList}
                onChange={handleListSelect}
                label="Select TMDB List"
            >
                {lists && lists.length > 0 ? (
                    lists.map((list) => (
                        <MenuItem key={list.id} value={list.id}>
                            {list.name} ({list.item_count})
                        </MenuItem>
                    ))
                ) : (
                    <MenuItem disabled value="">
                        No lists available
                    </MenuItem>
                )}
            </Select>
            {error && (
                <Typography color="error" variant="caption" sx={{ mt: 1 }}>
                    {error}
                </Typography>
            )}
        </FormControl>
    );

    return (
        <Box>
            <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
                {STEPS.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {error && (
                <Alert severity="error" onClose={handleCloseAlert} sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            {success && (
                <Alert severity="success" onClose={handleCloseAlert} sx={{ mb: 2 }}>
                    {success}
                </Alert>
            )}

            <Box sx={{ mt: 2 }}>
                {activeStep === 0 && (
                    <TextField
                        label="TMDB API Key"
                        value={localApiKey}
                        onChange={(e) => setLocalApiKey(e.target.value)}
                        type={showApiKey ? 'text' : 'password'}
                        fullWidth
                        error={!!error}
                        helperText={error}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton onClick={() => setShowApiKey(!showApiKey)} edge="end">
                                        {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />
                )}

                {activeStep === 1 && renderListSelection()}

                {activeStep === 2 && (
                    <Box>
                        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6">
                                Select Titles ({selectedItems.length} of {getSelectableItemCount()} selected)
                            </Typography>
                            <ButtonGroup>
                                <Button
                                    startIcon={<SelectAllIcon />}
                                    onClick={handleSelectAll}
                                    disabled={loading}
                                >
                                    Select All
                                </Button>
                                <Button
                                    startIcon={<ClearIcon />}
                                    onClick={handleClearSelection}
                                    disabled={loading}
                                >
                                    Clear
                                </Button>
                            </ButtonGroup>
                        </Box>

                        <Paper sx={{ maxHeight: 400, overflow: 'auto' }}>
                            <List>
                                {listItems.map((item) => {
                                    const isDisabled = !item.exists || item.in_watchlist;
                                    const isChecked = item.in_watchlist || selectedItems.indexOf(item.id) !== -1;

                                    return (
                                        <ListItem
                                            key={`${item.media_type}-${item.id}`}
                                            dense
                                            button={!isDisabled}
                                            onClick={() => !isDisabled && handleItemToggle(item.id)}
                                            sx={{
                                                opacity: isDisabled ? 0.7 : 1,
                                                cursor: isDisabled ? 'default' : 'pointer'
                                            }}
                                        >
                                            <ListItemIcon>
                                                <Checkbox
                                                    edge="start"
                                                    checked={isChecked}
                                                    disabled={isDisabled}
                                                    tabIndex={-1}
                                                    disableRipple
                                                />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={`${item.name} (${item.year})`}
                                                secondary={item.overview}
                                            />
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                {!item.exists && (
                                                    <Chip
                                                        label="Not Available"
                                                        size="small"
                                                        color="error"
                                                    />
                                                )}
                                                {item.exists && item.in_watchlist && (
                                                    <Chip
                                                        label="In Watchlist"
                                                        size="small"
                                                        color="primary"
                                                    />
                                                )}
                                                <Chip
                                                    icon={item.media_type === 'movie' ? <MovieIcon /> : <TvIcon />}
                                                    label={item.media_type === 'movie' ? 'Movie' : 'TV Show'}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </Box>
                                        </ListItem>
                                    );
                                })}
                            </List>
                        </Paper>
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                {activeStep === 0 ? (
                    <Button
                        variant="outlined"
                        onClick={handleCopyFromSettings}
                        startIcon={<ContentCopyIcon />}
                        disabled={loading}
                    >
                        Copy from TMDB Settings
                    </Button>
                ) : (
                    <Button
                        onClick={handleBack}
                        disabled={loading}
                        startIcon={<BackIcon />}
                    >
                        Back
                    </Button>
                )}
                <Button
                    variant="contained"
                    onClick={activeStep === 2 ? handleAddToWatchlist : handleNext}
                    disabled={
                        loading ||
                        (activeStep === 0 && !localApiKey) ||
                        (activeStep === 1 && !selectedList) ||
                        (activeStep === 2 && selectedItems.length === 0)
                    }
                    endIcon={activeStep === 2 ? <PlaylistAddIcon /> : <NextIcon />}
                >
                    {loading ? (
                        <CircularProgress size={24} />
                    ) : activeStep === 2 ? (
                        'Add to Watchlist'
                    ) : (
                        'Continue'
                    )}
                </Button>
            </Box>
        </Box>
    );
};

export default TMDBWatchlistImport;
