import { type DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /**
   * Extended session with user ID
   */
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  /**
   * Extended user type
   */
  interface User {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
  }
}
