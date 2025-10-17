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
      const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000'; // Fallback for safety

      const htmlResponse = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authentication Confirmation</title>
            <script>
                window.onload = () => {
                    const token = "${token}";
                    const user = ${JSON.stringify(user)};
                    const frontendOrigin = "${frontendOrigin}";

                    if (window.opener) {
                        window.opener.postMessage({ token, user }, frontendOrigin);
                    }
                    window.close();
                };
            </script>
        </head>
        <body>
            <p>Authenticating...</p>
        </body>
        </html>
      `;
      res.send(htmlResponse);
    } else {
      const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
      const htmlErrorResponse = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Authentication Failed</title>
            <script>
                window.onload = () => {
                    const frontendOrigin = "${frontendOrigin}";
                    if (window.opener) {
                        window.opener.postMessage({ message: 'Authentication failed' }, frontendOrigin);
                    }
                    window.close();
                };
            </script>
        </head>
        <body>
            <p>Authentication failed.</p>
        </body>
        </html>
      `;
      res.status(401).send(htmlErrorResponse);
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
