import prisma from '../db';
import { Profile } from 'passport-google-oauth20';

export const authService = {
  findOrCreateUser: async (profile: Profile) => {
    const { id, displayName, emails, photos } = profile;
    const email = emails && emails.length > 0 ? emails[0].value : undefined;
    const avatarUrl = photos && photos.length > 0 ? photos[0].value : undefined;

    if (!email) {
      throw new Error('Google profile did not provide an email address.');
    }

    let user = await prisma.user.findUnique({ where: { googleId: id } });

    if (!user) {
      // Check if a user with this email already exists (e.g., if they previously signed up with email/password)
      user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        // Link existing user to Google account
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: id,
            name: displayName,
            avatarUrl: avatarUrl,
            lastLoginAt: new Date(),
          },
        });
      } else {
        // Create new user
        user = await prisma.user.create({
          data: {
            googleId: id,
            email: email,
            name: displayName,
            avatarUrl: avatarUrl,
            lastLoginAt: new Date(),
            // subscriptionType defaults to PLUS as per schema.prisma
          },
        });
      }
    } else {
      // Update existing user's login time and profile info
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: displayName,
          avatarUrl: avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    }

    return user;
  },
};
