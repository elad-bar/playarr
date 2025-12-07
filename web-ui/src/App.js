import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Box, CircularProgress, CssBaseline, IconButton, Toolbar, Tooltip, Typography, AppBar, useMediaQuery } from '@mui/material';
import { DarkMode as DarkModeIcon, LightMode as LightModeIcon, Menu as MenuIcon } from '@mui/icons-material';
import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles';
import { selectTheme } from './store/slices/themeSlice';
import { toggleTheme } from './store/slices/themeSlice';
import { AuthProvider, useAuth } from './context/AuthContext';
import SystemHealthMonitor from './components/SystemHealthMonitor';
import PrivateRoute from './components/auth/PrivateRoute';
import { socketService } from './services/socket';
import Sidebar from './components/layout/Sidebar';
import Home from './pages/Home';
import Login from './pages/Login';
import TitleDetailsPage from './pages/TitleDetailsPage';
import Profile from './components/Profile';
import Clients from './components/profile/Clients';
import SettingsGeneral from './components/settings/SettingsGeneral';
import SettingsIPTVProviders from './components/settings/SettingsIPTVProviders';
import SettingsUsers from './components/settings/SettingsUsers';
import SettingsJobs from './components/settings/SettingsJobs';
import SettingsLogger from './components/settings/SettingsLogger';
import SettingsStatistics from './components/settings/SettingsStatistics';
import SettingsMetrics from './components/settings/SettingsMetrics';

const AppContent = () => {
    const dispatch = useDispatch();
    const theme = useSelector(selectTheme);
    const mode = useSelector(state => state.theme.mode);
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('sidebarOpen');
        return saved !== null ? JSON.parse(saved) : true;
    });

    // Persist sidebar state to localStorage
    useEffect(() => {
        localStorage.setItem('sidebarOpen', JSON.stringify(sidebarOpen));
    }, [sidebarOpen]);
    const location = useLocation();
    const { isAuthenticated, loading, user } = useAuth();
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


    const handleThemeToggle = () => {
        dispatch(toggleTheme());
    };

    const handleSidebarToggle = () => {
        setSidebarOpen(!sidebarOpen);
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
                        <AppBar 
                            position="fixed"
                            sx={{
                                display: isMobile && sidebarOpen ? 'none' : 'block',
                                zIndex: (muiTheme) =>
                                    isMobile
                                        ? muiTheme.zIndex.drawer - 1
                                        : muiTheme.zIndex.drawer + 1,
                                ml: !isMobile && sidebarOpen ? '280px' : 0,
                                width: !isMobile && sidebarOpen ? 'calc(100% - 280px)' : '100%',
                                transition: (muiTheme) =>
                                    muiTheme.transitions.create(['width', 'margin'], {
                                        easing: muiTheme.transitions.easing.sharp,
                                        duration: muiTheme.transitions.duration.enteringScreen,
                                    }),
                            }}
                        >
                            <Toolbar>
                                <IconButton
                                    color="inherit"
                                    aria-label="toggle sidebar"
                                    onClick={handleSidebarToggle}
                                    edge="start"
                                    sx={{ mr: 2 }}
                                >
                                    <MenuIcon />
                                </IconButton>
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
                            </Toolbar>
                        </AppBar>
                        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                    </>
                )}
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        p: isLoginPage ? 0 : { xs: 0, sm: 3 },
                        width: '100%',
                        ml: 0,
                        transition: (theme) =>
                            theme.transitions.create(['margin'], {
                                easing: theme.transitions.easing.sharp,
                                duration: theme.transitions.duration.enteringScreen,
                            }),
                    }}
                >
                    {!isLoginPage && isAuthenticated && <Toolbar />}
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route
                            path="/"
                            element={
                                <PrivateRoute>
                                    <Navigate to="/media/vod" replace />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/media/vod"
                            element={
                                <PrivateRoute>
                                    <Home />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/media/vod/:type/:titleId"
                            element={
                                <PrivateRoute>
                                    <TitleDetailsPage />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/media/channels"
                            element={
                                <PrivateRoute>
                                    <Home />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/profile"
                            element={
                                <PrivateRoute>
                                    <Profile />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/profile/clients"
                            element={
                                <PrivateRoute>
                                    <Clients />
                                </PrivateRoute>
                            }
                        />
                        {user?.role === 'admin' && (
                            <>
                                <Route
                                    path="/settings/general"
                                    element={
                                        <PrivateRoute>
                                            <SettingsGeneral />
                                        </PrivateRoute>
                                    }
                                />
                                <Route
                                    path="/settings/iptv-providers"
                                    element={
                                        <PrivateRoute>
                                            <SettingsIPTVProviders />
                                        </PrivateRoute>
                                    }
                                />
                                <Route
                                    path="/settings/users"
                                    element={
                                        <PrivateRoute>
                                            <SettingsUsers />
                                        </PrivateRoute>
                                    }
                                />
                                <Route
                                    path="/settings/jobs"
                                    element={
                                        <PrivateRoute>
                                            <SettingsJobs />
                                        </PrivateRoute>
                                    }
                                />
                                <Route
                                    path="/settings/logs"
                                    element={
                                        <PrivateRoute>
                                            <SettingsLogger />
                                        </PrivateRoute>
                                    }
                                />
                        <Route
                            path="/settings/statistics"
                            element={
                                <PrivateRoute>
                                    <SettingsStatistics />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/settings/metrics"
                            element={
                                <PrivateRoute>
                                    <SettingsMetrics />
                                </PrivateRoute>
                            }
                        />
                            </>
                        )}
                        {/* Keep /titles route for backwards compatibility */}
                        <Route
                            path="/titles"
                            element={
                                <PrivateRoute>
                                    <Navigate to="/media/vod" replace />
                                </PrivateRoute>
                            }
                        />
                    </Routes>
                </Box>
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
