import { unauthorizedError } from './errors';

// Simplified auth helper for demo purposes
// In production, this would use next-auth's getServerSession
export async function getCurrentUserId(): Promise<string> {
  // For demo purposes, we'll use a mock user ID
  // In production, integrate with next-auth
  const userId = process.env.DEMO_USER_ID || 'demo-user-id';

  if (!userId) {
    throw unauthorizedError();
  }

  return userId;
}

export async function getCurrentUser() {
  const userId = await getCurrentUserId();
  return { id: userId };
}
