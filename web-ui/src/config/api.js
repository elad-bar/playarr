// Add other API-related configuration as needed
export const API_ENDPOINTS = {
    // Titles endpoints
    titles: (mediaType, filters = {}) => {
        const params = new URLSearchParams();
        if (mediaType) params.append('media_type', mediaType);
        if (filters.searchQuery) params.append('search', filters.searchQuery);
        if (filters.yearFilter) params.append('year', filters.yearFilter);
        if (filters.selectedLetter) params.append('starts_with', filters.selectedLetter);
        if (filters.watchlistFilter && filters.watchlistFilter !== 'all') {
            params.append('watchlist', filters.watchlistFilter === 'checked' ? 'true' : 'false');
        }
        if (filters.page) params.append('page', filters.page);
        if (filters.per_page) params.append('per_page', filters.per_page);
        return `/titles${params.toString() ? `?${params.toString()}` : ''}`;
    },
    titleDetails: (titleKey) => `/titles/${titleKey}`,
    watchlist: (titleKey) => `/titles/${titleKey}/watchlist`,
    watchlistStats: `/titles/watchlist`,
    watchlistBulk: `/titles/watchlist/bulk`,

    // Stream endpoints
    streamMovie: (titleId) => `/api/stream/movies/${titleId}`,
    streamShow: (titleId, seasonNumber, episodeNumber) => `/api/stream/tvshows/${titleId}/${seasonNumber}/${episodeNumber}`,

    // Channels endpoints
    channels: (filters = {}) => {
        const params = new URLSearchParams();
        if (filters.searchQuery) params.append('search', filters.searchQuery);
        if (filters.providerId) params.append('providerId', filters.providerId);
        if (filters.watchlistFilter && filters.watchlistFilter !== 'all') {
            params.append('watchlist', filters.watchlistFilter === 'checked' ? 'true' : 'false');
        }
        // Add category filter - can be array or single value
        if (filters.categories && filters.categories.length > 0) {
            filters.categories.forEach(category => {
                params.append('category', category);
            });
        }
        if (filters.page) params.append('page', filters.page);
        if (filters.per_page) params.append('per_page', filters.per_page);
        return `/livetv/channels${params.toString() ? `?${params.toString()}` : ''}`;
    },
    channelWatchlist: (channelKey) => `/livetv/watchlist`,
    channelWatchlistRemove: (channelKey) => `/livetv/watchlist/${encodeURIComponent(channelKey)}`,
    channelCategories: () => `/livetv/categories`,

    // Providers endpoints
    providers: `/iptv/providers`,
    providerValidate: `/iptv/providers/validate`,
    providerCategories: (providerId) => `/iptv/providers/${providerId}/categories`,
    providerStatus: (providerId) => `/iptv/providers/${providerId}/status`,
    providerIgnoredTitles: (providerId) => `/iptv/providers/${providerId}/ignored`,

    // TMDB endpoints
    tmdb: {
        apiKey: `/tmdb/api-key`,
        verify: `/tmdb/verify`,
        lists: `/tmdb/lists`,
        listItems: (listId) => `/tmdb/lists/${listId}/items`,
        importList: `/tmdb/lists/import`
    },

    // Stats endpoints
    stats: `/stats`,

    // System endpoints
    healthcheck: `/healthcheck`,

    // Settings endpoints
    settings: {
        tmdbToken: '/settings/tmdb_token',
        logUnmanagedEndpoints: '/settings/log_unmanaged_endpoints',
        logStreamLevel: '/settings/log_stream_level',
    },

    // Jobs endpoints
    jobs: '/jobs',
    triggerJob: (jobName) => `/jobs/${jobName}/trigger`,
};
