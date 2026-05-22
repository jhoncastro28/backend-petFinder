import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../domain/enums';

const makeContext = (user: any): ExecutionContext =>
  ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ user }),
    }),
  }) as any;

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  it('should allow when no roles are required (undefined)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ role: UserRole.USER }))).toBe(true);
  });

  it('should allow when required roles list is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(makeContext({ role: UserRole.USER }))).toBe(true);
  });

  it('should allow when user has the required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(guard.canActivate(makeContext({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('should allow when user has one of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.MODERATOR]);
    expect(guard.canActivate(makeContext({ role: UserRole.MODERATOR }))).toBe(true);
  });

  it('should throw ForbiddenException when user does not have required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.USER }))).toThrow(
      ForbiddenException,
    );
  });

  it('should throw ForbiddenException when user is null in request', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext(null))).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException with role list in message', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.USER }))).toThrow(
      /Se requiere uno de los siguientes roles/,
    );
  });
});
