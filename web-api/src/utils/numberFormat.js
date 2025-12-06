/**
 * Number formatting utilities for locale-aware number display in logs
 */

/**
 * Format a number with locale-aware formatting
 * @param {number|string|null|undefined} value - Number to format
 * @param {Object} [options] - Formatting options
 * @param {number} [options.maximumFractionDigits] - Maximum fraction digits (default: 0 for integers)
 * @param {number} [options.minimumFractionDigits] - Minimum fraction digits
 * @param {string} [options.locale='en-US'] - Locale to use
 * @returns {string} Formatted number string
 */
export function formatNumber(value, options = {}) {
  // Handle null, undefined, NaN
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    return '0';
  }

  // Convert to number if string
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  // Handle invalid numbers
  if (isNaN(num)) {
    return '0';
  }

  const {
    maximumFractionDigits = 0,
    minimumFractionDigits = 0,
    locale = 'en-US'
  } = options;

  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits
  });

  return formatter.format(num);
}

/**
 * Format file size in bytes to human-readable format (MB/GB) with locale formatting
 * @param {number|string|null|undefined} bytes - File size in bytes
 * @param {string} [locale='en-US'] - Locale to use
 * @returns {string} Formatted file size (e.g., "1.23 MB" or "1,234.56 MB")
 */
export function formatFileSize(bytes, locale = 'en-US') {
  if (bytes === null || bytes === undefined || (typeof bytes === 'number' && isNaN(bytes))) {
    return '0 MB';
  }

  const numBytes = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  
  if (isNaN(numBytes) || numBytes < 0) {
    return '0 MB';
  }

  const MB = 1024 * 1024;
  const GB = 1024 * MB;

  let size;
  let unit;

  if (numBytes >= GB) {
    size = numBytes / GB;
    unit = 'GB';
  } else {
    size = numBytes / MB;
    unit = 'MB';
  }

  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });

  return `${formatter.format(size)} ${unit}`;
}

/**
 * Format a percentage value with locale-aware formatting
 * @param {number|string|null|undefined} value - Percentage value (0-100, not 0-1)
 * @param {number} [decimals=2] - Number of decimal places
 * @param {string} [locale='en-US'] - Locale to use
 * @returns {string} Formatted percentage with % symbol (e.g., "12.34%")
 */
export function formatPercentage(value, decimals = 2, locale = 'en-US') {
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    return '0%';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
    return '0%';
  }

  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });

  return `${formatter.format(num)}%`;
}

