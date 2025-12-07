import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Toolbar,
  useMediaQuery,
} from '@mui/material';
import {
  VideoLibrary as VideoLibraryIcon,
  LiveTv as LiveTvIcon,
  Person as PersonIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  Tune as GeneralSettingsIcon,
  Router as RouterIcon,
  PersonAdd as PersonAddIcon,
  Work as WorkIcon,
  Description as DescriptionIcon,
  BarChart as BarChartIcon,
  Assessment as AssessmentIcon,
  Logout as LogoutIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useAuth } from '../../context/AuthContext';

const DRAWER_WIDTH = 280;

/**
 * Sidebar navigation component
 * Provides persistent navigation menu with collapsible sections
 */
function Sidebar({ open, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const handleNavigate = (path) => {
    navigate(path);
    // Close sidebar on mobile after navigation, keep open on desktop
    if (isMobile && onClose) {
      onClose();
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path) => {
    // Exact match for specific routes
    if (path === '/media/vod' || path === '/media/channels') {
      return location.pathname === path;
    }
    // For profile routes, use exact matching to avoid highlighting both /profile and /profile/clients
    if (path === '/profile') {
      return location.pathname === path;
    }
    if (path === '/profile/clients') {
      return location.pathname === path;
    }
    // For other paths, use startsWith for sub-routes (e.g., /settings/*)
    return location.pathname.startsWith(path);
  };

  const menuItems = [
    {
      id: 'media',
      label: 'Media',
      icon: <VideoLibraryIcon />,
      expandable: true,
      items: [
        { path: '/media/vod', label: 'VOD', icon: <VideoLibraryIcon /> },
        { path: '/media/channels', label: 'Channels', icon: <LiveTvIcon /> },
      ],
    },
    {
      id: 'profile',
      label: 'Profile',
      icon: <PersonIcon />,
      expandable: true,
      items: [
        { path: '/profile', label: 'User Profile', icon: <PersonIcon /> },
        { path: '/profile/clients', label: 'Clients', icon: <PeopleIcon /> },
      ],
    },
    ...(isAdmin
      ? [
          {
            id: 'settings',
            label: 'Settings',
            icon: <SettingsIcon />,
            expandable: true,
            items: [
              { path: '/settings/general', label: 'General', icon: <GeneralSettingsIcon /> },
              { path: '/settings/iptv-providers', label: 'IPTV Providers', icon: <RouterIcon /> },
              { path: '/settings/users', label: 'Users', icon: <PersonAddIcon /> },
              { path: '/settings/jobs', label: 'Jobs', icon: <WorkIcon /> },
              { path: '/settings/logs', label: 'Log', icon: <DescriptionIcon /> },
              { path: '/settings/metrics', label: 'Metrics', icon: <BarChartIcon /> },
              { path: '/settings/statistics', label: 'Statistics', icon: <AssessmentIcon /> },
            ],
          },
        ]
      : []),
  ];

  return (
    <Drawer
      variant={isMobile ? 'temporary' : 'persistent'}
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: open ? (isMobile ? '100%' : DRAWER_WIDTH) : 0,
        flexShrink: 0,
        transition: (theme) =>
          theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        '& .MuiDrawer-paper': {
          width: isMobile ? '100%' : DRAWER_WIDTH,
          boxSizing: 'border-box',
          overflowX: 'hidden',
        },
      }}
    >
      <Toolbar
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        {isMobile && (
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="Close menu">
            <CloseIcon />
          </IconButton>
        )}
      </Toolbar>
      <Box sx={{ overflow: 'auto', height: '100%' }}>
        <List>
          {menuItems.map((section) => (
            <React.Fragment key={section.id}>
              <ListItem disablePadding>
                <ListItemButton
                  disabled
                  sx={{
                    '&.Mui-disabled': {
                      opacity: 1,
                      color: 'text.primary',
                    },
                  }}
                >
                  <ListItemText primary={section.label} />
                </ListItemButton>
              </ListItem>
              <List component="div" disablePadding>
                {section.items.map((item) => (
                  <ListItem key={item.path} disablePadding>
                    <ListItemButton
                      selected={isActive(item.path)}
                      onClick={() => handleNavigate(item.path)}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>{item.icon}</ListItemIcon>
                      <ListItemText primary={item.label} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </React.Fragment>
          ))}
        </List>
        <Divider />
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon />
              </ListItemIcon>
              <ListItemText primary="Logout" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Drawer>
  );
}

export default Sidebar;

