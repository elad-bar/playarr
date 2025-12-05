/**
 * Channel utility functions
 */

/**
 * Generate channel key (unique per provider)
 * @param {string} providerId - Provider ID
 * @param {string} channelId - Channel ID
 * @returns {string} Channel key in format "live-{providerId}-{channelId}"
 */
export function generateChannelKey(providerId, channelId) {
  return `live-${providerId}-${channelId}`;
}

