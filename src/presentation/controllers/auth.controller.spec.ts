import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from '../../application/services';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  validateToken: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
  verifyEmail: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
});

const mockUser = () => ({
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Juan',
  lastName: 'Pérez',
  role: 'user',
  isActive: true,
});

const authResponse = () => ({
  accessToken: 'access.token',
  refreshToken: 'refresh.token',
  user: mockUser(),
});

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;

  beforeEach(async () => {
    authService = mockAuthService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should delegate to authService.register and return result', async () => {
      const dto = {
        email: 'a@b.com',
        username: 'user',
        password: 'Pass123!',
        firstName: 'A',
        lastName: 'B',
      };
      const response = authResponse();
      authService.register.mockResolvedValue(response);

      const result = await controller.register(dto as any);

      expect(authService.register).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });
  });

  describe('login', () => {
    it('should delegate to authService.login and return result', async () => {
      const dto = { email: 'a@b.com', password: 'Pass123!' };
      const response = authResponse();
      authService.login.mockResolvedValue(response);

      const result = await controller.login(dto as any);

      expect(authService.login).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });
  });

  describe('refresh', () => {
    it('should use token field when present', async () => {
      const dto = { token: 'my.refresh.token' };
      authService.refresh.mockResolvedValue({ accessToken: 'new', refreshToken: 'new-r' });

      await controller.refresh(dto as any);

      expect(authService.refresh).toHaveBeenCalledWith('my.refresh.token');
    });

    it('should use refreshToken field as fallback', async () => {
      const dto = { refreshToken: 'my.refresh.token' };
      authService.refresh.mockResolvedValue({ accessToken: 'new', refreshToken: 'new-r' });

      await controller.refresh(dto as any);

      expect(authService.refresh).toHaveBeenCalledWith('my.refresh.token');
    });

    it('should pass empty string when no token field present', async () => {
      authService.refresh.mockResolvedValue({ accessToken: 'new', refreshToken: 'new-r' });

      await controller.refresh({} as any);

      expect(authService.refresh).toHaveBeenCalledWith('');
    });
  });

  describe('verifyByToken', () => {
    it('should call validateToken and return valid: true', async () => {
      authService.validateToken.mockResolvedValue(undefined);
      const dto = { token: 'some.token' };

      const result = await controller.verifyByToken(dto as any);

      expect(authService.validateToken).toHaveBeenCalledWith('some.token');
      expect(result).toEqual({ valid: true });
    });
  });

  describe('logout', () => {
    it('should delegate to authService.logout', async () => {
      const dto = { refreshToken: 'r.token' };
      authService.logout.mockResolvedValue({ message: 'Logout realizado' });

      const result = await controller.logout(dto as any);

      expect(authService.logout).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Logout realizado' });
    });
  });

  describe('logoutAll', () => {
    it('should call authService.logoutAll with user id', async () => {
      const user = mockUser();
      authService.logoutAll.mockResolvedValue({ message: 'Todas las sesiones cerradas' });

      const result = await controller.logoutAll(user as any);

      expect(authService.logoutAll).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ message: 'Todas las sesiones cerradas' });
    });
  });

  describe('verify (GET)', () => {
    it('should return valid: true with user payload', async () => {
      const user = mockUser();
      const result = await controller.verify(user as any);
      expect(result).toEqual({ valid: true, user });
    });
  });

  describe('verifyEmail', () => {
    it('should delegate to authService.verifyEmail', async () => {
      const dto = { code: '123456' };
      authService.verifyEmail.mockResolvedValue({ message: 'Email verificado' });

      const result = await controller.verifyEmail(dto as any);

      expect(authService.verifyEmail).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Email verificado' });
    });
  });

  describe('forgotPassword', () => {
    it('should delegate to authService.forgotPassword', async () => {
      const dto = { email: 'a@b.com' };
      authService.forgotPassword.mockResolvedValue({ message: 'Token enviado', resetToken: 'abc' });

      const result = await controller.forgotPassword(dto as any);

      expect(authService.forgotPassword).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Token enviado', resetToken: 'abc' });
    });
  });

  describe('resetPassword', () => {
    it('should delegate to authService.resetPassword', async () => {
      const dto = { token: 'reset-token', password: 'NewPass123!' };
      authService.resetPassword.mockResolvedValue({ message: 'Contraseña actualizada' });

      const result = await controller.resetPassword(dto as any);

      expect(authService.resetPassword).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: 'Contraseña actualizada' });
    });
  });
});
