import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { generateToken } from '../utils/jwt.utils';
import { User as PrismaUser } from '@prisma/client'; // Import PrismaUser type

export const authController = {
  googleCallback: async (req: Request, res: Response) => {
    // Passport populates req.user after successful authentication.
    // We need to ensure req.user is of a type that definitely has an 'id'.
    if (req.user && (req.user as PrismaUser).id) {
      const user = req.user as PrismaUser; // Assert req.user as PrismaUser
      const token = generateToken(user.id);
      res.json({ message: 'Authentication successful', token, user: user });
    } else {
      res.status(401).json({ message: 'Authentication failed: User object or ID missing.' });
    }
  },

  getMe: (req: Request, res: Response) => {
    if (req.user) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: 'Not authenticated' });
    }
  },

  logout: (req: Request, res: Response, next: NextFunction) => {
    req.logout((err) => {
      if (err) { return next(err); }
      if (req.session) {
        req.session.destroy((err) => {
          if (err) { return next(err); }
          res.clearCookie('connect.sid');
          res.json({ message: 'Logged out successfully' });
        });
      } else {
        res.json({ message: 'Logged out successfully (no session to destroy)' });
      }
    });
  },
};
