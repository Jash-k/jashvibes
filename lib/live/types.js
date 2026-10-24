/**
 * lib/live/types.js — v12 Live rebuild shared types
 * Pure JS docs; no runtime dependency.
 */

/**
 * @typedef {Object} LiveVariant
 * @property {string} sourceId  - e.g. 'hjh-jio', 'jio-tamil'
 * @property {string} sourceLabel
 * @property {string} url
 * @property {string} format - hls|dash|video|unknown
 * @property {boolean} playable
 * @property {string} keyId
 * @property {string} key
 * @property {string} licenseKey
 * @property {string} licenseType
 * @property {string} cookie
 * @property {string} userAgent
 * @property {string} referer
 * @property {Object} headers
 * @property {number} priority
 */

/**
 * @typedef {Object} LiveLogicalChannel
 * @property {string} logicalId - slug(baseName)|category
 * @property {string} displayName - human name without variant suffix
 * @property {string} baseName - stripped "[HLS · ...]"
 * @property {string} logo
 * @property {string} category
 * @property {string} language
 * @property {string[]} sourceIds
 * @property {LiveVariant[]} variants - sorted by priority
 * @property {LiveVariant} best - variants[0]
 */

/**
 * @typedef {Object} LiveSourceDef
 * @property {string} id
 * @property {string} label
 * @property {'m3u'|'json'} type
 * @property {string} url
 * @property {number} priority
 * @property {number} timeoutMs
 * @property {number} retry
 * @property {string} token - jio|hdnea_in_url|mixed|none
 * @property {boolean|'auto'} proxy
 * @property {string} drm
 * @property {boolean} trustTamil
 */
