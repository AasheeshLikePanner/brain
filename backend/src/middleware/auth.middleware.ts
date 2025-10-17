import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.utils';
import prisma from '../db';

export const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided or invalid format.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ message: 'Unauthorized: Invalid token.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, subscriptionType: true }, // Select relevant user fields
    });

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized: User not found.' });
    }

    req.user = user; // Attach user to request
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ message: 'Unauthorized: Token verification failed.' });
  }
};
