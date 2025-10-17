import { Router } from 'express';
import { authController } from '../../controllers/auth.controller';
import passport from 'passport';

const router = Router();

// Route to initiate Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback route after Google OAuth
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  authController.googleCallback
);

// Route to get the current authenticated user
router.get('/me', authController.getMe);

// Route to logout
router.get('/logout', authController.logout);

export default router;
