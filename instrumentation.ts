/**
 * Instrumentation entry (root)
 *
 * Re-export the src implementation so Next.js can resolve either location.
 */

export { register, onRequestError } from './src/instrumentation';
