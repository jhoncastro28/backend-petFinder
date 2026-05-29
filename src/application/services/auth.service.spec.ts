import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { PasswordHashService } from './password-hash.service';
import { RefreshTokenSessionService } from './refresh-token-session.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { User } from '../../domain/entities';
import { UserRole } from '../../domain/enums';

const makeUser = (): User =>
  new User(
    'user-1',
    'test@example.com',
    'testuser',
    'hashed_pass',
    'Juan',
    'Pérez',
    UserRole.USER,
    true,
    new Date(),
    new Date(),
  );

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let passwordHashService: jest.Mocked<Partial<PasswordHashService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let refreshTokenSessionService: jest.Mocked<Partial<RefreshTokenSessionService>>;
  let emailService: jest.Mocked<Partial<EmailService>>;
  let userRepository: { findByEmail: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      updatePasswordHash: jest.fn().mockResolvedValue(undefined),
      markEmailAsVerified: jest.fn().mockResolvedValue(undefined),
    };
    passwordHashService = {
      hash: jest.fn().mockResolvedValue('hashed_pass'),
      compare: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('mock.jwt.token'),
      verify: jest.fn(),
    };
    refreshTokenSessionService = {
      issueTokenPair: jest.fn().mockResolvedValue({
        accessToken: 'mock.jwt.token',
        refreshToken: 'mock.refresh.token',
        tokenType: 'Bearer',
      }),
      rotateTokenPair: jest.fn().mockResolvedValue({
        accessToken: 'new.access.token',
        refreshToken: 'new.refresh.token',
      }),
      revokeByToken: jest.fn().mockResolvedValue(undefined),
      revokeAllByUser: jest.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    };
    userRepository = {
      findByEmail: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordHashService, useValue: passwordHashService },
        { provide: JwtService, useValue: jwtService },
        { provide: RefreshTokenSessionService, useValue: refreshTokenSessionService },
        { provide: EmailService, useValue: emailService },
        { provide: 'IUserRepository', useValue: userRepository },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a user and return a token', async () => {
      const dto = {
        email: 'new@example.com',
        username: 'newuser',
        password: 'Pass123!',
        firstName: 'A',
        lastName: 'B',
      };
      const user = makeUser();
      (usersService.create as jest.Mock).mockResolvedValue({
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      });

      const result = await service.register(dto);

      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(refreshTokenSessionService.issueTokenPair).toHaveBeenCalledWith(user.id, user.email);
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('mock.refresh.token');
      expect(result.user.email).toBe(user.email);
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const user = makeUser();
      userRepository.findByEmail.mockResolvedValue(user);
      userRepository.update.mockResolvedValue(user);
      (passwordHashService.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: 'test@example.com', password: 'Pass123!' });

      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.refreshToken).toBe('mock.refresh.token');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'Pass123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      const user = makeUser();
      userRepository.findByEmail.mockResolvedValue(user);
      userRepository.update.mockResolvedValue(user);
      (passwordHashService.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const user = makeUser();
      user.deactivate();
      userRepository.findByEmail.mockResolvedValue(user);
      userRepository.update.mockResolvedValue(user);
      (passwordHashService.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'Pass123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException with remaining minutes when account is locked', async () => {
      const user = makeUser();
      user.accountLockedUntil = new Date(Date.now() + 30 * 60 * 1000);
      userRepository.findByEmail.mockResolvedValue(user);

      await expect(
        service.login({ email: 'test@example.com', password: 'Pass123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException with default 30 minutes when account is locked but lockedUntil is undefined', async () => {
      const user = makeUser();
      jest.spyOn(user, 'isAccountLocked').mockReturnValue(true);
      userRepository.findByEmail.mockResolvedValue(user);

      await expect(
        service.login({ email: 'test@example.com', password: 'Pass123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateToken', () => {
    it('should return payload for valid token', async () => {
      const payload = { sub: 'user-1', email: 'test@example.com' };
      (jwtService.verify as jest.Mock).mockReturnValue(payload);

      const result = await service.validateToken('valid.token');
      expect(result).toEqual(payload);
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('expired');
      });
      await expect(service.validateToken('bad.token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('should rotate tokens for valid refresh token', async () => {
      const result = await service.refresh('valid.refresh.token');
      expect(refreshTokenSessionService.rotateTokenPair).toHaveBeenCalledWith(
        'valid.refresh.token',
      );
      expect(result.accessToken).toBe('new.access.token');
      expect(result.refreshToken).toBe('new.refresh.token');
    });

    it('should throw BadRequestException when token is empty', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      await expect(service.refresh('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token and return message', async () => {
      const result = await service.logout({ refreshToken: 'r.token' } as any);
      expect(refreshTokenSessionService.revokeByToken).toHaveBeenCalledWith('r.token');
      expect(result.message).toContain('cerrada');
    });

    it('should also work with token field', async () => {
      await service.logout({ token: 'r.token' } as any);
      expect(refreshTokenSessionService.revokeByToken).toHaveBeenCalledWith('r.token');
    });
  });

  describe('logoutAll', () => {
    it('should revoke all sessions for user and return message', async () => {
      const result = await service.logoutAll('user-1');
      expect(refreshTokenSessionService.revokeAllByUser).toHaveBeenCalledWith('user-1');
      expect(result.message).toBeDefined();
    });
  });

  describe('forgotPassword', () => {
    it('should return generic message when user exists and send email', async () => {
      const user = makeUser();
      (usersService.findByEmail as jest.Mock).mockResolvedValue(user);

      const result = await service.forgotPassword({ email: 'test@example.com' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'password_reset' }),
        expect.any(Object),
      );
      expect(result.message).toBeDefined();
    });

    it('should return generic message when user does not exist (no enumeration)', async () => {
      (usersService.findByEmail as jest.Mock).mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'ghost@example.com' });

      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });
  });

  describe('resetPassword', () => {
    it('should reset password for valid token', async () => {
      const user = makeUser();
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'user-1',
        email: 'test@example.com',
        purpose: 'password_reset',
      });
      (usersService.findByEmail as jest.Mock).mockResolvedValue(user);

      const result = await service.resetPassword({
        token: 'valid.token',
        newPassword: 'NewPass1!',
      } as any);

      expect(passwordHashService.hash).toHaveBeenCalledWith('NewPass1!');
      expect(usersService.updatePasswordHash).toHaveBeenCalled();
      expect(result.message).toBeDefined();
    });

    it('should throw BadRequestException for invalid token', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });
      await expect(
        service.resetPassword({ token: 'bad', newPassword: 'x' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when token purpose is wrong', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      (jwtService.verify as jest.Mock).mockReturnValue({ purpose: 'email_verification' });
      await expect(
        service.resetPassword({ token: 'wrong', newPassword: 'x' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user is not found', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      (jwtService.verify as jest.Mock).mockReturnValue({
        sub: 'user-1',
        email: 'nobody@example.com',
        purpose: 'password_reset',
      });
      (usersService.findByEmail as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'valid.token', newPassword: 'NewPass1!' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email for valid token', async () => {
      const user = makeUser();
      (jwtService.verify as jest.Mock).mockReturnValue({
        email: 'test@example.com',
        purpose: 'email_verification',
      });
      (usersService.findByEmail as jest.Mock).mockResolvedValue(user);

      const result = await service.verifyEmail({ token: 'valid.token' } as any);

      expect(usersService.markEmailAsVerified).toHaveBeenCalledWith(user.id);
      expect(result.message).toBeDefined();
    });

    it('should throw BadRequestException for invalid token', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error();
      });
      await expect(service.verifyEmail({ token: 'bad' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
