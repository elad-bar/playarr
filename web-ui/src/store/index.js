import { configureStore } from '@reduxjs/toolkit';
import providerReducer from './slices/providerSlice';
import themeReducer from './slices/themeSlice';
import titlesReducer from './slices/titlesSlice';
import channelsReducer from './slices/channelsSlice';

export const store = configureStore({
  reducer: {
    providers: providerReducer,
    theme: themeReducer,
    titles: titlesReducer,
    channels: channelsReducer,
  },
});
