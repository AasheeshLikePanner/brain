import { User as PrismaUser } from '@prisma/client';

declare global {
  namespace Express {
    // Define a more specific User interface for req.user
    interface User extends Pick<PrismaUser, 'id' | 'email' | 'name' | 'avatarUrl' | 'subscriptionType'> {}

    interface Request {
      user?: User;
    }
  }
}
