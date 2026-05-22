import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PasswordHashService } from './password-hash.service';
import { IUserRepository, IReportRepository } from '../../domain/repositories';
import { User } from '../../domain/entities';
import { UserRole } from '../../domain/enums';
import { AzureBlobStorageService } from '../../infrastructure/external-services/azure';

const makeUser = (
  overrides: Partial<{
    id: string;
    email: string;
    username: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
): User =>
  new User(
    overrides.id ?? 'user-1',
    overrides.email ?? 'test@example.com',
    overrides.username ?? 'testuser',
    overrides.password ?? 'hashed_pass',
    overrides.firstName ?? 'Juan',
    overrides.lastName ?? 'Pérez',
    overrides.role ?? UserRole.USER,
    overrides.isActive ?? true,
    overrides.createdAt ?? new Date(),
    overrides.updatedAt ?? new Date(),
  );

const mockUserRepository = (): jest.Mocked<IUserRepository> => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByUsername: jest.fn(),
  findAll: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  existsByEmail: jest.fn(),
  existsByUsername: jest.fn(),
});

const mockPasswordHashService = () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
  isHashValid: jest.fn().mockReturnValue(true),
  getSaltRounds: jest.fn().mockReturnValue(12),
  needsRehash: jest.fn().mockReturnValue(false),
});

const mockReportRepository = (): jest.Mocked<IReportRepository> => ({
  create: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  countActive: jest.fn(),
});

const mockAzureBlobStorageService = () => ({
  uploadImage: jest.fn().mockResolvedValue({
    imageUrl: 'https://storage.blob.core.windows.net/pet-images/avatars/test.jpg',
    signedUrl: 'https://storage.blob.core.windows.net/pet-images/avatars/test.jpg?sig=dummy',
    blobName: 'avatars/test.jpg',
  }),
  deleteBlobByUrl: jest.fn().mockResolvedValue(undefined),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<IUserRepository>;
  let reportRepo: jest.Mocked<IReportRepository>;
  let passwordHash: ReturnType<typeof mockPasswordHashService>;
  let azureBlobStorage: ReturnType<typeof mockAzureBlobStorageService>;

  beforeEach(async () => {
    repo = mockUserRepository();
    reportRepo = mockReportRepository();
    passwordHash = mockPasswordHashService();
    azureBlobStorage = mockAzureBlobStorageService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: 'IUserRepository', useValue: repo },
        { provide: 'IReportRepository', useValue: reportRepo },
        { provide: PasswordHashService, useValue: passwordHash },
        { provide: AzureBlobStorageService, useValue: azureBlobStorage },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    const dto = {
      email: 'nuevo@example.com',
      username: 'nuevo',
      password: 'Password123!',
      firstName: 'Nuevo',
      lastName: 'Usuario',
    };

    it('should create a user successfully', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.findByUsername.mockResolvedValue(null);
      const savedUser = new User(
        'user-2',
        dto.email,
        dto.username,
        'hashed_password',
        dto.firstName,
        dto.lastName,
        UserRole.USER,
        true,
        new Date(),
        new Date(),
      );
      repo.create.mockResolvedValue(savedUser);

      const result = await service.create(dto);

      expect(repo.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(repo.findByUsername).toHaveBeenCalledWith(dto.username);
      expect(passwordHash.hash).toHaveBeenCalledWith(dto.password);
      expect(repo.create).toHaveBeenCalled();
      expect(result.email).toBe(dto.email);
    });

    it('should throw BadRequestException if email already exists', async () => {
      repo.findByEmail.mockResolvedValue(makeUser());
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow('El email ya está registrado');
    });

    it('should throw BadRequestException if username already exists', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.findByUsername.mockResolvedValue(makeUser());
      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow('El username ya está en uso');
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      const result = await service.findOne('user-1');
      expect(result.id).toBe('user-1');
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all users as DTOs', async () => {
      const users = [makeUser(), makeUser()];
      repo.findAll.mockResolvedValue(users);
      const result = await service.findAll();
      expect(result.length).toBe(2);
    });

    it('should return empty array when no users', async () => {
      repo.findAll.mockResolvedValue([]);
      const result = await service.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update user profile', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);
      const result = await service.update('user-1', { firstName: 'Carlos' });
      expect(repo.update).toHaveBeenCalledWith('user-1', user);
      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when updating nonexistent user', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update('ghost', { firstName: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should deactivate the user', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);
      await service.remove('user-1');
      expect(user.isActive).toBe(false);
      expect(repo.update).toHaveBeenCalledWith('user-1', user);
    });

    it('should throw NotFoundException if user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return user when found', async () => {
      const user = makeUser();
      repo.findByEmail.mockResolvedValue(user);
      const result = await service.findByEmail('test@example.com');
      expect(result).toBe(user);
    });

    it('should return null when not found', async () => {
      repo.findByEmail.mockResolvedValue(null);
      const result = await service.findByEmail('ghost@example.com');
      expect(result).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('should change password when current is correct and new is different', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);
      passwordHash.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await service.changePassword('user-1', 'OldPass1!', 'NewPass1!');

      expect(passwordHash.hash).toHaveBeenCalledWith('NewPass1!');
      expect(repo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.changePassword('ghost', 'old', 'new')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when current password is wrong', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwordHash.compare.mockResolvedValueOnce(false);
      await expect(service.changePassword('user-1', 'wrong', 'NewPass1!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when new password equals current', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwordHash.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      await expect(service.changePassword('user-1', 'Same1!', 'Same1!')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUserStats', () => {
    it('should return stats with report counts', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      reportRepo.findByUserId.mockResolvedValue([
        { status: 'active' } as any,
        { status: 'resolved' } as any,
        { status: 'resolved' } as any,
      ]);

      const result = await service.getUserStats('user-1');

      expect(result.reportsPublished).toBe(3);
      expect(result.successfulReunions).toBe(2);
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getUserStats('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar and return signed url', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);

      const result = await service.uploadAvatar('user-1', { buffer: Buffer.from('img') });

      expect(azureBlobStorage.uploadImage).toHaveBeenCalledWith(
        expect.any(Object),
        'avatars',
        'user-1',
      );
      expect(typeof result).toBe('string');
    });

    it('should throw BadRequestException when no file', async () => {
      await expect(service.uploadAvatar('user-1', null)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.uploadAvatar('ghost', { buffer: Buffer.from('x') })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteAvatar', () => {
    it('should delete avatar and clear profileImage', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);

      await service.deleteAvatar('user-1');

      expect(azureBlobStorage.deleteBlobByUrl).toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deleteAvatar('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteAccount', () => {
    it('should deactivate user and their reports', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);
      passwordHash.compare.mockResolvedValue(true);
      reportRepo.findByUserId.mockResolvedValue([
        { status: 'active', id: 'r1', deactivate: jest.fn() } as any,
      ]);
      reportRepo.update.mockResolvedValue(undefined);

      await service.deleteAccount('user-1', 'Pass1!');

      expect(user.isActive).toBe(false);
      expect(repo.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when password is wrong', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwordHash.compare.mockResolvedValue(false);
      await expect(service.deleteAccount('user-1', 'wrong')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deleteAccount('ghost', 'pass')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePasswordHash', () => {
    it('should update password hash directly', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);

      await service.updatePasswordHash('user-1', 'new_hashed_pass');

      expect(user.password).toBe('new_hashed_pass');
      expect(repo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updatePasswordHash('ghost', 'hash')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markEmailAsVerified', () => {
    it('should verify email of user', async () => {
      const user = makeUser();
      repo.findById.mockResolvedValue(user);
      repo.update.mockResolvedValue(user);

      await service.markEmailAsVerified('user-1');

      expect(user.emailVerified).toBe(true);
      expect(repo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when user not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.markEmailAsVerified('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
