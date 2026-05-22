import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from '../../application/services';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { UserRole } from '../../domain/enums';

const mockUsersService = () => ({
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  getUserStats: jest.fn(),
  changePassword: jest.fn(),
  uploadAvatar: jest.fn(),
  deleteAvatar: jest.fn(),
  deleteAccount: jest.fn(),
});

const mockUserJwt = (role = UserRole.USER, id = 'user-1') => ({
  id,
  email: 'test@example.com',
  username: 'testuser',
  role,
  isActive: true,
});

const FIXED_DATE = '2025-01-01T00:00:00.000Z';
const userResponse = () => ({
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  firstName: 'Juan',
  lastName: 'Pérez',
  role: 'user',
  isActive: true,
  createdAt: FIXED_DATE,
});

describe('UsersController', () => {
  let controller: UsersController;
  let service: ReturnType<typeof mockUsersService>;

  beforeEach(async () => {
    service = mockUsersService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  describe('create', () => {
    it('should create user and return DTO', async () => {
      const dto = {
        email: 'a@b.com',
        username: 'user',
        password: 'Pass123!',
        firstName: 'A',
        lastName: 'B',
      };
      service.create.mockResolvedValue(userResponse());

      const result = await controller.create(dto as any);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(userResponse());
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const users = [userResponse(), userResponse()];
      service.findAll.mockResolvedValue(users);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return stats for authenticated user', async () => {
      const stats = { totalReports: 5, activeReports: 3 };
      service.getUserStats.mockResolvedValue(stats);

      const result = await controller.getStats(mockUserJwt() as any);

      expect(service.getUserStats).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(stats);
    });
  });

  describe('getProfile', () => {
    it('should return the authenticated user profile', async () => {
      service.findOne.mockResolvedValue(userResponse());

      const result = await controller.getProfile(mockUserJwt() as any);

      expect(service.findOne).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(userResponse());
    });
  });

  describe('getProfileAlias', () => {
    it('should return the same as getProfile', async () => {
      service.findOne.mockResolvedValue(userResponse());
      const result = await controller.getProfileAlias(mockUserJwt() as any);
      expect(service.findOne).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(userResponse());
    });
  });

  describe('findOne', () => {
    it('should allow user to access their own profile', async () => {
      service.findOne.mockResolvedValue(userResponse());

      const result = await controller.findOne('user-1', mockUserJwt() as any);

      expect(service.findOne).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(userResponse());
    });

    it('should allow ADMIN to access any user', async () => {
      service.findOne.mockResolvedValue(userResponse());
      const admin = mockUserJwt(UserRole.ADMIN, 'admin-99');

      const result = await controller.findOne('user-1', admin as any);

      expect(service.findOne).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(userResponse());
    });

    it('should throw ForbiddenException when non-admin accesses another user', async () => {
      const user = mockUserJwt(UserRole.USER, 'user-1');

      await expect(controller.findOne('user-2', user as any)).rejects.toThrow(ForbiddenException);
      expect(service.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('should update the authenticated user profile', async () => {
      const dto = { firstName: 'Carlos' };
      service.update.mockResolvedValue(userResponse());

      const result = await controller.updateProfile(mockUserJwt() as any, dto as any);

      expect(service.update).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual(userResponse());
    });
  });

  describe('updateProfileAlias', () => {
    it('should also update the profile', async () => {
      const dto = { lastName: 'López' };
      service.update.mockResolvedValue(userResponse());

      await controller.updateProfileAlias(mockUserJwt() as any, dto as any);

      expect(service.update).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('changePassword', () => {
    it('should change password and return success message', async () => {
      service.changePassword.mockResolvedValue(undefined);
      const dto = { currentPassword: 'OldPass1!', newPassword: 'NewPass1!' };

      const result = await controller.changePassword(mockUserJwt() as any, dto as any);

      expect(service.changePassword).toHaveBeenCalledWith('user-1', 'OldPass1!', 'NewPass1!');
      expect(result).toEqual({ message: 'Contrasena actualizada correctamente' });
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar and return avatarUrl', async () => {
      service.uploadAvatar.mockResolvedValue('https://blob.core.windows.net/avatars/test.jpg');
      const file = { buffer: Buffer.from('img'), originalname: 'test.jpg' };

      const result = await controller.uploadAvatar(mockUserJwt() as any, file as any);

      expect(service.uploadAvatar).toHaveBeenCalledWith('user-1', file);
      expect(result).toEqual({ avatarUrl: 'https://blob.core.windows.net/avatars/test.jpg' });
    });
  });

  describe('deleteAvatar', () => {
    it('should call service.deleteAvatar', async () => {
      service.deleteAvatar.mockResolvedValue(undefined);

      await controller.deleteAvatar(mockUserJwt() as any);

      expect(service.deleteAvatar).toHaveBeenCalledWith('user-1');
    });
  });

  describe('deleteAccount', () => {
    it('should call service.deleteAccount with user id and password', async () => {
      service.deleteAccount.mockResolvedValue(undefined);
      const dto = { password: 'MyPass1!' };

      await controller.deleteAccount(mockUserJwt() as any, dto as any);

      expect(service.deleteAccount).toHaveBeenCalledWith('user-1', 'MyPass1!');
    });
  });

  describe('update (admin)', () => {
    it('should update any user by id', async () => {
      const dto = { firstName: 'Admin-Updated' };
      service.update.mockResolvedValue(userResponse());

      const result = await controller.update('user-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual(userResponse());
    });
  });

  describe('remove (admin)', () => {
    it('should remove user by id', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.remove('user-1');

      expect(service.remove).toHaveBeenCalledWith('user-1');
    });
  });
});
