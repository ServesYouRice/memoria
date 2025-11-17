/**
 * Auth Options Export
 *
 * This file provides backward compatibility for routes that import authOptions.
 * It re-exports the authConfig from the main auth configuration.
 */

export { authConfig as authOptions } from './auth/config';
