import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationType } from '../../domain/entities';

const makeNotification = (overrides: Partial<{ id: string; userId: string; read: boolean }> = {}) =>
  new Notification(
    overrides.id ?? 'notif-1',
    overrides.userId ?? 'user-1',
    NotificationType.UPDATE,
    'Titulo',
    'Mensaje de prueba',
    overrides.read ?? false,
    new Date(),
  );

const mockNotificationRepository = () => ({
  findByUserId: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  markAllAsReadByUserId: jest.fn(),
  delete: jest.fn(),
  create: jest.fn(),
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: ReturnType<typeof mockNotificationRepository>;

  beforeEach(async () => {
    repo = mockNotificationRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService, { provide: 'INotificationRepository', useValue: repo }],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('findByUserId', () => {
    it('should return notifications for a user', async () => {
      const notifications = [makeNotification(), makeNotification({ id: 'notif-2' })];
      repo.findByUserId.mockResolvedValue(notifications);

      const result = await service.findByUserId('user-1');

      expect(repo.findByUserId).toHaveBeenCalledWith('user-1', undefined);
      expect(result).toHaveLength(2);
    });

    it('should pass filters to repository', async () => {
      repo.findByUserId.mockResolvedValue([]);

      await service.findByUserId('user-1', { read: false });

      expect(repo.findByUserId).toHaveBeenCalledWith('user-1', { read: false });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notif = makeNotification();
      repo.findById.mockResolvedValue(notif);
      repo.update.mockResolvedValue(notif);

      await service.markAsRead('notif-1', 'user-1');

      expect(notif.read).toBe(true);
      expect(repo.update).toHaveBeenCalledWith('notif-1', notif);
    });

    it('should throw NotFoundException when notification not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.markAsRead('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when notification belongs to other user', async () => {
      const notif = makeNotification({ userId: 'other-user' });
      repo.findById.mockResolvedValue(notif);
      await expect(service.markAsRead('notif-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markAllAsRead', () => {
    it('should call repository markAllAsReadByUserId', async () => {
      repo.markAllAsReadByUserId.mockResolvedValue(undefined);

      await service.markAllAsRead('user-1');

      expect(repo.markAllAsReadByUserId).toHaveBeenCalledWith('user-1');
    });
  });

  describe('delete', () => {
    it('should delete notification when user owns it', async () => {
      const notif = makeNotification();
      repo.findById.mockResolvedValue(notif);
      repo.delete.mockResolvedValue(undefined);

      await service.delete('notif-1', 'user-1');

      expect(repo.delete).toHaveBeenCalledWith('notif-1');
    });

    it('should throw NotFoundException when notification not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.delete('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when notification belongs to other user', async () => {
      const notif = makeNotification({ userId: 'other-user' });
      repo.findById.mockResolvedValue(notif);
      await expect(service.delete('notif-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('should create a notification and return it', async () => {
      const notif = makeNotification();
      repo.create.mockResolvedValue(notif);

      const result = await service.create(
        'user-1',
        NotificationType.UPDATE,
        'Titulo',
        'Mensaje',
        'post-1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: NotificationType.UPDATE,
          title: 'Titulo',
          message: 'Mensaje',
          relatedPostId: 'post-1',
          read: false,
        }),
      );
      expect(result).toBe(notif);
    });

    it('should create notification without relatedPostId', async () => {
      const notif = makeNotification();
      repo.create.mockResolvedValue(notif);

      await service.create('user-1', NotificationType.SYSTEM, 'Sistema', 'Msg');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ relatedPostId: undefined }),
      );
    });
  });
});
