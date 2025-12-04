import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Box, CircularProgress, CssBaseline, IconButton, Toolbar, Tooltip, Typography, AppBar, Menu, MenuItem } from '@mui/material';
import { DarkMode as DarkModeIcon, LightMode as LightModeIcon, AccountCircle as AccountCircleIcon, VideoLibrary as VideoLibraryIcon, LiveTv as LiveTvIcon } from '@mui/icons-material';
import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles';
import { selectTheme } from './store/slices/themeSlice';
import { toggleTheme } from './store/slices/themeSlice';
import { AuthProvider, useAuth } from './context/AuthContext';
import SystemHealthMonitor from './components/SystemHealthMonitor';
import PrivateRoute from './components/auth/PrivateRoute';
import { socketService } from './services/socket';
import Home from './pages/Home';
import Settings from './components/Settings';
import Login from './pages/Login';
import Profile from './components/Profile';
import axiosInstance from './config/axios';

const AppContent = () => {
    const dispatch = useDispatch();
    const theme = useSelector(selectTheme);
    const mode = useSelector(state => state.theme.mode);
    const [anchorEl, setAnchorEl] = useState(null);
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [contentMode, setContentMode] = useState(() => {
        const saved = localStorage.getItem('playarr_content_mode');
        return saved || 'vod';
    });
    const [hasChannels, setHasChannels] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, loading, user, logout } = useAuth();
    const isLoginPage = location.pathname === '/login';

    // Don't render layout until auth check is complete, unless on login page
    const shouldShowLayout = !loading && (isAuthenticated || isLoginPage);

    // Suppress ResizeObserver errors (common harmless error with Material-UI dialogs)
    useEffect(() => {
        const originalError = window.onerror;
        window.onerror = (message, source, lineno, colno, error) => {
            if (
                typeof message === 'string' &&
                (message.includes('ResizeObserver loop') ||
                 message.includes('ResizeObserver loop completed with undelivered notifications'))
            ) {
                // Suppress this specific error as it's harmless
                return true;
            }
            // Let other errors through
            if (originalError) {
                return originalError(message, source, lineno, colno, error);
            }
            return false;
        };

        // Also catch unhandled promise rejections
        const originalRejection = window.onunhandledrejection;
        window.onunhandledrejection = (event) => {
            if (
                event.reason &&
                typeof event.reason === 'string' &&
                (event.reason.includes('ResizeObserver loop') ||
                 event.reason.includes('ResizeObserver loop completed with undelivered notifications'))
            ) {
                event.preventDefault();
                return;
            }
            if (originalRejection) {
                return originalRejection(event);
            }
        };

        return () => {
            window.onerror = originalError;
            window.onunhandledrejection = originalRejection;
        };
    }, []);

    useEffect(() => {
        // Only connect to WebSocket when authenticated
        if (isAuthenticated) {
            socketService.connect();

            // Disconnect when component unmounts or user logs out
            return () => {
                socketService.disconnect();
            };
        } else {
            // Disconnect if not authenticated
            socketService.disconnect();
        }
    }, [isAuthenticated]);

    // Check if channels are available from providers
    useEffect(() => {
        if (isAuthenticated && user) {
            const checkChannels = async () => {
                try {
                    // Make a lightweight request to check if channels exist
                    // Using watchlist=false to get all channels, not just watchlist
                    const response = await axiosInstance.get('/livetv/channels?watchlist=false&page=1&per_page=1');
                    // Handle both old format (array) and new format (paginated object)
                    const hasChannelsData = response.data && (
                        (Array.isArray(response.data) && response.data.length > 0) ||
                        (response.data.items && response.data.items.length > 0) ||
                        (response.data.pagination && response.data.pagination.total > 0)
                    );
                    setHasChannels(hasChannelsData);
                    
                    // After checking channels, validate contentMode
                    // Only reset to 'vod' if user doesn't have channels but contentMode is 'tv'
                    if (!hasChannelsData) {
                        const savedMode = localStorage.getItem('playarr_content_mode');
                        if (savedMode === 'tv') {
                            setContentMode('vod');
                            localStorage.setItem('playarr_content_mode', 'vod');
                        }
                    }
                } catch (error) {
                    // If error, assume no channels available
                    setHasChannels(false);
                    // Validate contentMode after error - reset to 'vod' if needed
                    const savedMode = localStorage.getItem('playarr_content_mode');
                    if (savedMode === 'tv') {
                        setContentMode('vod');
                        localStorage.setItem('playarr_content_mode', 'vod');
                    }
                }
            };
            checkChannels();
        } else {
            setHasChannels(false);
        }
    }, [isAuthenticated, user]);

    const handleThemeToggle = () => {
        dispatch(toggleTheme());
    };

    const handleProfileMenuOpen = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleProfileMenuClose = () => {
        setAnchorEl(null);
    };

    const handleProfileClick = () => {
        setProfileDialogOpen(true);
        handleProfileMenuClose();
    };

    const handleProfileDialogClose = () => {
        setProfileDialogOpen(false);
        // Delay navigation to allow dialog animation to complete
        setTimeout(() => {
            navigate('/');
        }, 100);
    };

    const handleSettingsClick = () => {
        setSettingsDialogOpen(true);
        handleProfileMenuClose();
    };

    const handleSettingsDialogClose = () => {
        setSettingsDialogOpen(false);
        navigate('/');
    };

    const handleLogout = async () => {
        // Reset contentMode to 'vod' and clear from localStorage
        setContentMode('vod');
        localStorage.removeItem('playarr_content_mode');
        await logout();
        navigate('/login');
        handleProfileMenuClose();
    };

    // Show loading spinner while checking authentication (unless on login page)
    if (loading && !isLoginPage) {
        return (
            <MUIThemeProvider theme={theme}>
                <CssBaseline />
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: '100vh',
                    }}
                >
                    <CircularProgress />
                </Box>
            </MUIThemeProvider>
        );
    }

    // Only render full layout if authenticated or on login page
    if (!shouldShowLayout) {
        // This shouldn't happen due to PrivateRoute, but handle it gracefully
        return (
            <MUIThemeProvider theme={theme}>
                <CssBaseline />
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </MUIThemeProvider>
        );
    }

    return (
        <MUIThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{ display: 'flex' }}>
                {!isLoginPage && isAuthenticated && (
                    <>
                        <SystemHealthMonitor />
                        <AppBar position="fixed">
                            <Toolbar>
                                <Typography
                                    variant="h6"
                                    component="div"
                                    sx={{
                                        flexGrow: 1
                                    }}
                                >
                                    Playarr
                                </Typography>
                                <Tooltip title={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}>
                                    <IconButton color="inherit" onClick={handleThemeToggle}>
                                        {mode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
                                    </IconButton>
                                </Tooltip>
                                {hasChannels && (
                                    <>
                                        <Tooltip title="Video on Demand">
                                            <IconButton
                                                color="inherit"
                                                onClick={() => {
                                                    setContentMode('vod');
                                                    localStorage.setItem('playarr_content_mode', 'vod');
                                                }}
                                                disabled={contentMode === 'vod'}
                                            >
                                                <VideoLibraryIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Live TV">
                                            <IconButton
                                                color="inherit"
                                                onClick={() => {
                                                    setContentMode('tv');
                                                    localStorage.setItem('playarr_content_mode', 'tv');
                                                }}
                                                disabled={contentMode === 'tv'}
                                            >
                                                <LiveTvIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </>
                                )}
                                <Tooltip title="Account menu">
                                    <IconButton
                                        color="inherit"
                                        onClick={handleProfileMenuOpen}
                                        edge="end"
                                    >
                                        <AccountCircleIcon />
                                    </IconButton>
                                </Tooltip>
                                <Menu
                                    anchorEl={anchorEl}
                                    open={Boolean(anchorEl)}
                                    onClose={handleProfileMenuClose}
                                    anchorOrigin={{
                                        vertical: 'bottom',
                                        horizontal: 'right',
                                    }}
                                    transformOrigin={{
                                        vertical: 'top',
                                        horizontal: 'right',
                                    }}
                                >
                                    {user && (
                                        <MenuItem disabled>
                                            <Typography variant="body2" color="text.secondary">
                                                {user.first_name} {user.last_name} ({user.username})
                                            </Typography>
                                        </MenuItem>
                                    )}
                                    <MenuItem onClick={handleProfileClick}>Profile</MenuItem>
                                    {user?.role === 'admin' && (
                                        <MenuItem onClick={handleSettingsClick}>Settings</MenuItem>
                                    )}
                                    <MenuItem onClick={handleLogout}>Logout</MenuItem>
                                </Menu>
                            </Toolbar>
                        </AppBar>
                    </>
                )}
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        p: isLoginPage ? 0 : 3,
                        width: '100%'
                    }}
                >
                    {!isLoginPage && isAuthenticated && <Toolbar />}
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route
                            path="/"
                            element={
                                <PrivateRoute>
                                    <Home contentMode={contentMode} />
                                </PrivateRoute>
                            }
                        />
                        {/* Keep /titles route for backwards compatibility */}
                        <Route
                            path="/titles"
                            element={
                                <PrivateRoute>
                                    <Home />
                                </PrivateRoute>
                            }
                        />
                    </Routes>
                </Box>
                {isAuthenticated && (
                    <>
                        <Profile open={profileDialogOpen} onClose={handleProfileDialogClose} />
                        {user?.role === 'admin' && (
                            <Settings open={settingsDialogOpen} onClose={handleSettingsDialogClose} />
                        )}
                    </>
                )}
            </Box>
        </MUIThemeProvider>
    );
};

const App = () => {
    return (
        <Router>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </Router>
    );
};

export default App;
