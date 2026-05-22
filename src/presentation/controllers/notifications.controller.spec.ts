import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../../application/services';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Notification, NotificationType } from '../../domain/entities';

const mockNotificationsService = () => ({
  findByUserId: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  delete: jest.fn(),
});

const mockUser = () => ({
  id: 'user-1',
  email: 'test@example.com',
  role: 'user',
});

const makeNotification = (read = false) =>
  new Notification(
    'notif-1',
    'user-1',
    NotificationType.UPDATE,
    'Titulo',
    'Mensaje',
    read,
    new Date(),
  );

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: ReturnType<typeof mockNotificationsService>;

  beforeEach(async () => {
    service = mockNotificationsService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  describe('getAll', () => {
    it('should return notifications with default pagination', async () => {
      const notifications = [makeNotification()];
      service.findByUserId.mockResolvedValue(notifications);

      const result = await controller.getAll(mockUser() as any, '1', '20', undefined);

      expect(service.findByUserId).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 20,
        read: undefined,
      });
      expect(result).toBe(notifications);
    });

    it('should parse read=true query param', async () => {
      service.findByUserId.mockResolvedValue([]);

      await controller.getAll(mockUser() as any, '1', '10', 'true');

      expect(service.findByUserId).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 10,
        read: true,
      });
    });

    it('should parse read=false query param', async () => {
      service.findByUserId.mockResolvedValue([]);

      await controller.getAll(mockUser() as any, '1', '10', 'false');

      expect(service.findByUserId).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 10,
        read: false,
      });
    });
  });

  describe('getUnread', () => {
    it('should return count and notifications list', async () => {
      const unread = [makeNotification(false), makeNotification(false)];
      service.findByUserId.mockResolvedValue(unread);

      const result = await controller.getUnread(mockUser() as any);

      expect(service.findByUserId).toHaveBeenCalledWith('user-1', { read: false });
      expect(result).toEqual({ count: 2, notifications: unread });
    });

    it('should return count 0 when no unread', async () => {
      service.findByUserId.mockResolvedValue([]);
      const result = await controller.getUnread(mockUser() as any);
      expect(result).toEqual({ count: 0, notifications: [] });
    });
  });

  describe('markAsRead', () => {
    it('should call service.markAsRead and return message', async () => {
      service.markAsRead.mockResolvedValue(undefined);

      const result = await controller.markAsRead(mockUser() as any, 'notif-1');

      expect(service.markAsRead).toHaveBeenCalledWith('notif-1', 'user-1');
      expect(result).toEqual({ message: 'Notificacion marcada como leida' });
    });
  });

  describe('markAllAsRead', () => {
    it('should call service.markAllAsRead and return message', async () => {
      service.markAllAsRead.mockResolvedValue(undefined);

      const result = await controller.markAllAsRead(mockUser() as any);

      expect(service.markAllAsRead).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ message: 'Todas las notificaciones marcadas como leidas' });
    });
  });

  describe('delete', () => {
    it('should call service.delete and return message', async () => {
      service.delete.mockResolvedValue(undefined);

      const result = await controller.delete(mockUser() as any, 'notif-1');

      expect(service.delete).toHaveBeenCalledWith('notif-1', 'user-1');
      expect(result).toEqual({ message: 'Notificacion eliminada' });
    });
  });
});
