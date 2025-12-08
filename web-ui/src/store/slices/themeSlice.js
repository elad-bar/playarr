import { createSlice } from '@reduxjs/toolkit';
import { createSelector } from '@reduxjs/toolkit';
import Cookies from 'js-cookie';
import { createTheme } from '@mui/material/styles';

const getInitialMode = () => {
  const savedMode = Cookies.get('themeMode');
  return savedMode || 'light';
};

const createAppTheme = (mode) => createTheme({
  palette: {
    mode,
    primary: {
      main: '#00bcd4',
      light: '#4dd0e1',
      dark: '#0097a7',
    },
    secondary: {
      main: '#9c27b0',
      light: '#ba68c8',
      dark: '#7b1fa2',
    },
    success: {
      main: '#4caf50',
    },
    warning: {
      main: '#ff9800',
    },
    error: {
      main: '#f44336',
    },
    background: {
      default: mode === 'light' ? '#f5f5f5' : '#121212',
      paper: mode === 'light' ? '#ffffff' : '#1e1e1e',
    },
    text: {
      primary: mode === 'light' ? 'rgba(0, 0, 0, 0.87)' : '#ffffff',
      secondary: mode === 'light' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)',
    },
  },
  typography: {
    fontFamily: [
      'Inter',
      'Roboto',
      'Segoe UI',
      'Arial',
      'sans-serif'
    ].join(','),
    fontSize: 13,
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small'
      }
    },
    MuiTextField: {
      defaultProps: {
        size: 'small'
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '6px 10px'
        }
      }
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: mode === 'dark' ? '#555 #121212' : '#999 #f5f5f5'
        },
        '*::-webkit-scrollbar': {
          width: '8px'
        },
        '*::-webkit-scrollbar-track': {
          background: mode === 'dark' ? '#121212' : '#f5f5f5'
        },
        '*::-webkit-scrollbar-thumb': {
          background: mode === 'dark' ? '#555' : '#999',
          borderRadius: '4px'
        }
      }
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: mode === 'light' ? '#ffffff' : '#1e1e1e',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'light' ? '#00bcd4' : '#1e1e1e',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'light' ? '#ffffff' : '#1e1e1e',
        },
      },
    },
  },
});

const initialState = {
  mode: getInitialMode()
};

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.mode = state.mode === 'light' ? 'dark' : 'light';
      Cookies.set('themeMode', state.mode, { expires: 365 });
    }
  }
});

export const { toggleTheme } = themeSlice.actions;

// Memoized selector to get theme mode
const selectThemeMode = state => state.theme.mode;

// Memoized selector to create theme object
export const selectTheme = createSelector(
  [selectThemeMode],
  (mode) => createAppTheme(mode)
);

export default themeSlice.reducer;
