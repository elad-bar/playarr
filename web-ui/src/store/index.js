import { configureStore } from '@reduxjs/toolkit';
import providerReducer from './slices/providerSlice';
import statsReducer from './slices/statsSlice';
import themeReducer from './slices/themeSlice';
import titlesReducer from './slices/titlesSlice';
import settingsReducer from './slices/settingsSlice';
import channelsReducer from './slices/channelsSlice';

export const store = configureStore({
  reducer: {
    providers: providerReducer,
    stats: statsReducer,
    theme: themeReducer,
    titles: titlesReducer,
    settings: settingsReducer,
    channels: channelsReducer,
  },
});
